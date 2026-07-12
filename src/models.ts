import * as vscode from 'vscode';

export type ProjectKind = 'web' | 'test' | 'console' | 'library' | 'docker' | 'unknown';

export interface SolutionModel {
  readonly name: string;
  readonly path?: string;
  readonly rootPath: string;
  readonly projects: ProjectModel[];
}

export interface ProjectModel {
  readonly name: string;
  readonly path: string;
  readonly directory: string;
  readonly relativePath: string;
  readonly solutionFolder?: string[];
  readonly kind: ProjectKind;
  readonly rootNamespace?: string;
  readonly assemblyName?: string;
  readonly targetFrameworks: string[];
  readonly launchProfiles: LaunchProfile[];
  readonly packageReferences: PackageReference[];
  readonly projectReferences: ProjectReference[];
}

export interface LaunchProfile {
  readonly name: string;
  readonly commandName?: string;
  readonly applicationUrl?: string;
  readonly environmentVariables?: Record<string, string>;
  readonly commandLineArgs?: string;
  readonly launchBrowser?: boolean;
}

export interface RunTarget {
  readonly projectPath: string;
  readonly profileName?: string;
}

export interface RunConfig {
  readonly id: string;
  readonly label: string;
  readonly kind: 'single' | 'compound';
  readonly targets: RunTarget[];
}

export interface PackageReference {
  readonly name: string;
  readonly version?: string;
}

export interface ProjectReference {
  readonly name: string;
  readonly path: string;
}

export type TreeNodeKind =
  | 'solution'
  | 'project'
  | 'dependencies'
  | 'projectReferences'
  | 'packageReferences'
  | 'projectReference'
  | 'packageReference'
  | 'folder'
  | 'file'
  | 'runConfigs'
  | 'runConfig'
  | 'message';

export interface TreeNode {
  readonly kind: TreeNodeKind;
  readonly label: string;
  readonly id?: string;
  readonly resourcePath?: string;
  readonly project?: ProjectModel;
  readonly configId?: string;
  readonly children?: TreeNode[];
  readonly collapsibleState?: vscode.TreeItemCollapsibleState;
}
