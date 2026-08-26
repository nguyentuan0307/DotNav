import * as path from 'path';
import { BuildChangeTracker } from './buildChangeTracker';
import { StoredBuildState, StoredProjectState } from './buildStateStore';
import { FingerprintSession, mapConcurrent, sameFingerprint, stableFingerprint } from './fingerprints';
import { BuildReason, EvaluatedBuildGraph, EvaluatedProjectVariant, ProjectBuildPlan, SmartBuildPlan } from './types';

export class SmartBuildPlanner {
  constructor(private readonly changes?: BuildChangeTracker) {}

  async tryFastPathPlan(
    graph: EvaluatedBuildGraph,
    state: StoredBuildState | undefined
  ): Promise<SmartBuildPlan | undefined> {
    if (!state || !this.changes || this.changes.hasPendingChanges()) return undefined;
    const graphFingerprint = fingerprintGraph(graph);
    if (state.graphFingerprint !== graphFingerprint) return undefined;
    if (graph.projects.some(project => project.isOpaque)) return undefined;

    const fingerprints = new FingerprintSession();
    const projects: ProjectBuildPlan[] = [];

    for (const project of graph.projects) {
      const stored = state.projects[project.id];
      if (!stored || stored.projectFingerprint !== fingerprintProject(project)) return undefined;
      const targetPath = project.targetPath;
      if (targetPath) {
        const prevOutput = stored.outputs[targetPath];
        if (!prevOutput) return undefined;
        const current = await fingerprints.fingerprintAgainst(targetPath, prevOutput);
        if (!current || !sameFingerprint(current, prevOutput)) return undefined;
      }
      if (project.assetsFile) {
        const prevAssets = stored.inputs[project.assetsFile];
        if (!prevAssets) return undefined;
        const current = await fingerprints.fingerprintAgainst(project.assetsFile, prevAssets);
        if (!current || !sameFingerprint(current, prevAssets)) return undefined;
      }

      // Fast mtime/size sanity check on all project inputs
      const inputChecks = await mapConcurrent(project.inputs, 32, async input => {
        const prev = stored.inputs[input];
        if (!prev) return false;
        const current = await fingerprints.fingerprintAgainst(input, prev, false);
        return Boolean(current && sameFingerprint(current, prev));
      });
      if (inputChecks.some(valid => !valid)) return undefined;

      projects.push(plan(project, 'up-to-date', []));
    }

    return { createdAt: Date.now(), graphFingerprint, projects, requiresRestore: false };
  }

  async createPlan(graph: EvaluatedBuildGraph, state?: StoredBuildState): Promise<SmartBuildPlan> {
    const fastPlan = await this.tryFastPathPlan(graph, state);
    if (fastPlan) return fastPlan;

    const graphFingerprint = fingerprintGraph(graph);
    const fingerprints = new FingerprintSession();
    const projects: ProjectBuildPlan[] = [];

    for (const project of graph.projects) {
      projects.push(await this.planProject(project, graphFingerprint, state, fingerprints));
    }

    promoteReferencedCopies(projects);
    let requiresRestore = projects.some(item => item.decision !== 'up-to-date' && !state?.projects[item.project.id]);
    for (const item of projects.filter(item => item.decision !== 'up-to-date')) {
      if (item.project.assetsFile && !await fingerprints.fingerprint(item.project.assetsFile)) requiresRestore = true;
      if (item.reasons.some(reason => reason.detail && isRestoreInput(reason.detail))) requiresRestore = true;
    }
    return { createdAt: Date.now(), graphFingerprint, projects, requiresRestore };
  }

  async createDependentPlan(
    graph: EvaluatedBuildGraph,
    primaryPlan: SmartBuildPlan,
    state?: StoredBuildState
  ): Promise<SmartBuildPlan> {
    const primary = new Set(primaryPlan.projects
      .filter(item => item.decision === 'build' || item.decision === 'fallback')
      .map(item => normalize(item.project.projectPath)));
    if (primary.size === 0) return emptyFollowUp(graph, primaryPlan);

    const fingerprints = new FingerprintSession();
    const apiChanged = new Set<string>();
    for (const item of primaryPlan.projects.filter(item => primary.has(normalize(item.project.projectPath)))) {
      const stored = state?.projects[item.project.id];
      const reference = item.project.referenceAssemblyPath
        ? await fingerprints.fingerprint(item.project.referenceAssemblyPath)
        : undefined;
      if (item.decision === 'fallback' || !stored?.referenceAssemblySha256 || !reference
        || reference.sha256 !== stored.referenceAssemblySha256) {
        apiChanged.add(normalize(item.project.projectPath));
      }
    }

    const affected = reverseClosure(primaryPlan.projects, primary);
    const rebuild = reverseClosure(primaryPlan.projects, apiChanged);
    const projects = primaryPlan.projects.map(item => {
      const projectPath = normalize(item.project.projectPath);
      if (primary.has(projectPath) || !affected.has(projectPath) || item.decision !== 'up-to-date') {
        return plan(item.project, 'up-to-date', []);
      }
      return rebuild.has(projectPath)
        ? plan(item.project, 'build', [{ code: 'public-api-changed', detail: 'A referenced project public API changed.' }])
        : plan(item.project, 'propagate', [{ code: 'reference-output-propagation', detail: 'Referenced implementation changed without a public API change.' }]);
    });
    return { createdAt: Date.now(), graphFingerprint: fingerprintGraph(graph), projects, requiresRestore: false };
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
  const fingerprints = await mapConcurrent(paths, 32, filePath => session.fingerprint(filePath));
  for (let index = 0; index < paths.length; index += 1) {
    const filePath = paths[index];
    const fingerprint = fingerprints[index];
    if (fingerprint) result[filePath] = fingerprint;
  }
  return result;
}

function reverseClosure(projects: readonly ProjectBuildPlan[], roots: ReadonlySet<string>): Set<string> {
  const dirtyPaths = new Set(roots);
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
  return dirtyPaths;
}

function emptyFollowUp(graph: EvaluatedBuildGraph, primaryPlan: SmartBuildPlan): SmartBuildPlan {
  return {
    createdAt: Date.now(), graphFingerprint: fingerprintGraph(graph), requiresRestore: false,
    projects: primaryPlan.projects.map(item => plan(item.project, 'up-to-date', []))
  };
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
