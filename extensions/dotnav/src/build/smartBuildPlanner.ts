import * as path from 'path';
import { BuildChangeTracker } from './buildChangeTracker';
import { StoredBuildState, StoredProjectState } from './buildStateStore';
import { FingerprintSession, sameFingerprint, stableFingerprint } from './fingerprints';
import { BuildReason, EvaluatedBuildGraph, EvaluatedProjectVariant, ProjectBuildPlan, SmartBuildPlan } from './types';

export class SmartBuildPlanner {
  constructor(private readonly changes?: BuildChangeTracker) {}

  async createPlan(graph: EvaluatedBuildGraph, state?: StoredBuildState): Promise<SmartBuildPlan> {
    const graphFingerprint = fingerprintGraph(graph);
    const fingerprints = new FingerprintSession();
    const projects: ProjectBuildPlan[] = [];

    for (const project of graph.projects) {
      projects.push(await this.planProject(project, graphFingerprint, state, fingerprints));
    }

    promoteReferencedCopies(projects);
    propagateDependentBuilds(projects);
    let requiresRestore = projects.some(item => item.decision !== 'up-to-date' && !state?.projects[item.project.id]);
    for (const item of projects.filter(item => item.decision !== 'up-to-date')) {
      if (item.project.assetsFile && !await fingerprints.fingerprint(item.project.assetsFile)) requiresRestore = true;
      if (item.reasons.some(reason => reason.detail && isRestoreInput(reason.detail))) requiresRestore = true;
    }
    return { createdAt: Date.now(), graphFingerprint, projects, requiresRestore };
  }

  async captureSuccessfulState(
    graph: EvaluatedBuildGraph,
    buildStart: number,
    buildEnd: number
  ): Promise<StoredBuildState> {
    const fingerprints = new FingerprintSession();
    const projects: Record<string, StoredProjectState> = {};
    for (const project of graph.projects) {
      const inputs = await fingerprintPaths(project.inputs, fingerprints);
      const outputs = await fingerprintPaths(project.outputs, fingerprints);
      projects[project.id] = {
        projectFingerprint: fingerprintProject(project),
        inputs,
        outputs,
        referenceAssemblySha256: outputs[project.referenceAssemblyPath]?.sha256,
        implementationAssemblySha256: outputs[project.targetPath]?.sha256,
        lastSuccessfulBuildStart: buildStart,
        lastSuccessfulBuildEnd: buildEnd
      };
    }
    return {
      schemaVersion: 1,
      graphFingerprint: fingerprintGraph(graph),
      projects
    };
  }

  private async planProject(
    project: EvaluatedProjectVariant,
    graphFingerprint: string,
    state: StoredBuildState | undefined,
    fingerprints: FingerprintSession
  ): Promise<ProjectBuildPlan> {
    if (project.isOpaque) {
      return plan(project, 'fallback', [{ code: 'opaque-project', detail: project.opaqueReasons.join(', ') }]);
    }
    const stored = state?.projects[project.id];
    if (!stored) return plan(project, 'build', [{ code: 'first-run' }]);
    const reasons: BuildReason[] = [];
    if (state?.graphFingerprint !== graphFingerprint || stored.projectFingerprint !== fingerprintProject(project)) {
      reasons.push({ code: 'project-graph-changed' });
    }

    const currentInputPaths = new Set(project.inputs);
    const storedInputPaths = new Set(Object.keys(stored.inputs));
    for (const input of currentInputPaths) {
      if (!storedInputPaths.has(input)) reasons.push({ code: 'input-added', detail: input });
      const previous = stored.inputs[input];
      const current = await fingerprints.fingerprintAgainst(input, previous, this.changes?.hasChanged(input));
      if (!current) reasons.push({ code: 'input-missing', detail: input });
      else if (previous && !sameFingerprint(current, previous)) {
        reasons.push({ code: this.changes?.hasChanged(input) ? 'source-changed' : 'source-changed', detail: input });
      }
    }
    for (const input of storedInputPaths) {
      if (!currentInputPaths.has(input)) reasons.push({ code: 'input-removed', detail: input });
    }
    const copyDestinations = new Set(project.copies.map(copy => normalize(copy.destination)));
    for (const output of project.outputs) {
      if (copyDestinations.has(normalize(output))) continue;
      const previous = stored.outputs[output];
      const current = await fingerprints.fingerprintAgainst(output, previous);
      if (!current) reasons.push({ code: 'output-missing', detail: output });
      else if (previous && !sameFingerprint(current, previous)) reasons.push({ code: 'output-changed', detail: output });
    }
    if (reasons.length > 0) return plan(project, 'build', deduplicateReasons(reasons));

    const staleCopies = [];
    for (const copy of project.copies) {
      const source = await fingerprints.fingerprintAgainst(
        copy.source,
        stored.inputs[copy.source],
        this.changes?.hasChanged(copy.source)
      );
      const destination = await fingerprints.fingerprintAgainst(copy.destination, stored.outputs[copy.destination]);
      const preserveNewest = copy.mode.toLowerCase() === 'preservenewest';
      if (!source || !destination || !sameFingerprint(source, destination)
        || (preserveNewest && source.mtimeMs > destination.mtimeMs)) staleCopies.push(copy);
    }
    if (staleCopies.length > 0) {
      return { project, decision: 'copy', copies: staleCopies, reasons: [{ code: 'copy-destination-stale' }] };
    }
    return plan(project, 'up-to-date', []);
  }
}

export function fingerprintGraph(graph: EvaluatedBuildGraph): string {
  return stableFingerprint({
    msbuildPath: graph.msbuildPath,
    msbuildVersion: graph.msbuildVersion,
    globalProperties: graph.globalProperties,
    projects: graph.projects.map(project => ({ id: project.id, references: project.projectReferences }))
  });
}

function fingerprintProject(project: EvaluatedProjectVariant): string {
  return stableFingerprint({
    id: project.id,
    references: project.projectReferences,
    inputs: project.inputs,
    outputs: project.outputs,
    copies: project.copies,
    opaque: project.opaqueReasons
  });
}

async function fingerprintPaths(paths: readonly string[], session: FingerprintSession) {
  const result: Record<string, Awaited<ReturnType<FingerprintSession['fingerprint']>> & {}> = {};
  const fingerprints = await Promise.all(paths.map(filePath => session.fingerprint(filePath)));
  for (let index = 0; index < paths.length; index += 1) {
    const filePath = paths[index];
    const fingerprint = fingerprints[index];
    if (fingerprint) result[filePath] = fingerprint;
  }
  return result;
}

function propagateDependentBuilds(projects: ProjectBuildPlan[]): void {
  const byPath = new Map<string, ProjectBuildPlan[]>();
  for (const item of projects) {
    const key = normalize(item.project.projectPath);
    const existing = byPath.get(key) ?? [];
    existing.push(item);
    byPath.set(key, existing);
  }
  const dirtyPaths = new Set(projects
    .filter(item => item.decision === 'build' || item.decision === 'fallback')
    .map(item => normalize(item.project.projectPath)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of projects) {
      if (dirtyPaths.has(normalize(item.project.projectPath))) continue;
      if (item.project.projectReferences.some(reference => dirtyPaths.has(normalize(reference)))) {
        dirtyPaths.add(normalize(item.project.projectPath));
        changed = true;
      }
    }
  }
  for (let index = 0; index < projects.length; index += 1) {
    const item = projects[index];
    if (item.decision === 'up-to-date' && dirtyPaths.has(normalize(item.project.projectPath))) {
      projects[index] = plan(item.project, 'build', [{ code: 'source-changed', detail: 'Referenced project requires output propagation.' }]);
    }
  }
}

function promoteReferencedCopies(projects: ProjectBuildPlan[]): void {
  const referenced = new Set(projects.flatMap(item => item.project.projectReferences).map(normalize));
  for (let index = 0; index < projects.length; index += 1) {
    const item = projects[index];
    if (item.decision === 'copy' && referenced.has(normalize(item.project.projectPath))) {
      projects[index] = plan(item.project, 'build', item.reasons);
    }
  }
}

function plan(project: EvaluatedProjectVariant, decision: ProjectBuildPlan['decision'], reasons: BuildReason[]): ProjectBuildPlan {
  return { project, decision, reasons, copies: [] };
}

function deduplicateReasons(reasons: BuildReason[]): BuildReason[] {
  const seen = new Set<string>();
  return reasons.filter(reason => {
    const key = `${reason.code}:${reason.detail ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalize(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isRestoreInput(value: string): boolean {
  const name = path.basename(value).toLowerCase();
  return /\.(csproj|fsproj|vbproj)$/.test(name)
    || name === 'directory.packages.props'
    || name === 'nuget.config'
    || name === 'packages.lock.json'
    || name === 'global.json';
}
