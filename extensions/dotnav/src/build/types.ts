export const smartBuildProtocolVersion = 2;

export interface BuildHostInfo {
  readonly protocolVersion: number;
  readonly hostVersion: string;
  readonly msbuildPath: string;
  readonly msbuildVersion: string;
}

export interface BuildFileCopy {
  readonly source: string;
  readonly destination: string;
  readonly mode: string;
}

export interface EvaluatedProjectVariant {
  readonly id: string;
  readonly projectPath: string;
  readonly projectName: string;
  readonly configuration: string;
  readonly platform: string;
  readonly targetFramework: string;
  readonly runtimeIdentifier: string;
  readonly targetPath: string;
  readonly referenceAssemblyPath: string;
  readonly intermediateOutputPath: string;
  readonly outputPath: string;
  readonly assetsFile: string;
  readonly isSdkStyle: boolean;
  readonly isOpaque: boolean;
  readonly opaqueReasons: string[];
  readonly projectReferences: string[];
  readonly inputs: string[];
  readonly imports: string[];
  readonly outputs: string[];
  readonly copies: BuildFileCopy[];
}

export interface EvaluatedBuildGraph {
  readonly protocolVersion: number;
  readonly msbuildPath: string;
  readonly msbuildVersion: string;
  readonly globalProperties: Record<string, string>;
  readonly projects: EvaluatedProjectVariant[];
}

export type BuildReasonCode =
  | 'first-run'
  | 'source-changed'
  | 'input-added'
  | 'input-removed'
  | 'input-missing'
  | 'output-missing'
  | 'output-changed'
  | 'copy-destination-stale'
  | 'project-graph-changed'
  | 'configuration-changed'
  | 'sdk-changed'
  | 'restore-required'
  | 'opaque-project'
  | 'previous-build-failed'
  | 'changed-during-build'
  | 'public-api-changed'
  | 'reference-output-propagation'
  | 'cache-invalid';

export interface BuildReason {
  readonly code: BuildReasonCode;
  readonly detail?: string;
}

export type ProjectBuildDecision = 'up-to-date' | 'build' | 'copy' | 'propagate' | 'fallback';

export interface ProjectBuildPlan {
  readonly project: EvaluatedProjectVariant;
  readonly decision: ProjectBuildDecision;
  readonly reasons: BuildReason[];
  readonly copies: BuildFileCopy[];
}

export interface SmartBuildPlan {
  readonly createdAt: number;
  readonly graphFingerprint: string;
  readonly projects: ProjectBuildPlan[];
  readonly requiresRestore: boolean;
}
