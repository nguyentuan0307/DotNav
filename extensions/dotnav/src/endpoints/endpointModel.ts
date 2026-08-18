export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS' | 'ANY';

export interface RouteParameterInfo {
  readonly name: string;
  readonly typeConstraint?: string;
  readonly isOptional?: boolean;
  readonly defaultValue?: string;
}

export interface RouteSegmentDescriptor {
  readonly raw: string;
  readonly isParam: boolean;
  readonly paramName?: string;
  readonly constraint?: string;
  readonly cleanText: string;
  readonly variations: readonly string[];
}

export interface ApiEndpoint {
  readonly id: string;
  readonly httpMethod: HttpMethod;
  readonly routeTemplate: string;
  readonly normalizedRoute: string;
  readonly segments: readonly RouteSegmentDescriptor[];
  readonly controllerName?: string;
  readonly actionName?: string;
  readonly kind: 'controller' | 'minimalApi';
  readonly filePath: string;
  readonly relativePath: string;
  readonly line: number; // 1-indexed line in source file
  readonly projectName: string;
  readonly parameters?: readonly string[];
  readonly routeParameters?: readonly RouteParameterInfo[];
  readonly authorization?: readonly string[];
  readonly returnType?: string;
  readonly groupName?: string;
}

export interface EndpointSearchResult {
  readonly endpoint: ApiEndpoint;
  readonly score: number;
  readonly matchReason: string;
  readonly highlightIndices?: readonly [number, number][];
}
