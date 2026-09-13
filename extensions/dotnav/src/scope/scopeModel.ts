export type ScopeTargetKind = 'project' | 'solutionFolder';

export interface ScopeTarget {
  readonly kind: ScopeTargetKind;
  readonly value: string; // Project file path or Solution Folder display path (e.g. "Services/CustomApp")
  readonly label?: string;
}

export interface SolutionScope {
  readonly id: string;
  readonly name: string;
  readonly targets: readonly ScopeTarget[];
  readonly includeDependencies: boolean;
  readonly activeProjectPaths: readonly string[];
  readonly sourceSlnfPath?: string;
}

export interface ScopePreset {
  readonly id: string;
  readonly name: string;
  readonly targets: readonly ScopeTarget[];
  readonly includeDependencies: boolean;
}

export interface MicrosoftSlnf {
  readonly solution: {
    readonly path: string;
    readonly projects: readonly string[];
  };
}
