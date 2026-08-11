import * as path from 'path';
import { EvaluatedBuildGraph } from './types';

export class BuildChangeTracker {
  private generation = 0;
  private graphInvalidated = true;
  private graphGeneration = 0;
  private readonly changedPaths = new Map<string, number>();
  private watchedInputs = new Set<string>();

  updateGraph(graph: EvaluatedBuildGraph): void {
    this.watchedInputs = new Set(graph.projects.flatMap(project => project.inputs).map(normalize));
    this.graphInvalidated = false;
  }

  recordChange(filePath: string): void {
    const normalized = normalize(filePath);
    if (isIgnoredBuildPath(filePath)) return;
    const watched = this.watchedInputs.has(normalized);
    const graphInput = isGraphInput(filePath);
    this.generation += 1;
    if (watched) this.changedPaths.set(normalized, this.generation);
    // An untracked file may have just entered an SDK default glob or a custom item glob.
    if (graphInput || !watched) {
      this.graphInvalidated = true;
      this.graphGeneration += 1;
    }
  }

  snapshot(): number {
    return this.generation;
  }

  changedSince(generation: number): boolean {
    return this.generation > generation;
  }

  hasChanged(filePath: string): boolean {
    return this.changedPaths.has(normalize(filePath));
  }

  consumeChanges(): void {
    this.changedPaths.clear();
  }

  needsGraphEvaluation(): boolean {
    return this.graphInvalidated;
  }

  graphRevision(): number {
    return this.graphGeneration;
  }

  invalidateGraph(): void {
    this.graphInvalidated = true;
    this.graphGeneration += 1;
  }
}

function isGraphInput(filePath: string): boolean {
  const name = path.basename(filePath);
  return /\.(sln|slnx|csproj|fsproj|vbproj|props|targets)$/i.test(name)
    || /^(global\.json|nuget\.config|packages\.lock\.json)$/i.test(name);
}

function isIgnoredBuildPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return /(?:^|\/)\.?((?:bin)|(?:obj)|(?:\.git)|(?:\.vs))(?:\/|$)/i.test(normalized);
}

function normalize(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
