export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS' | 'ANY';

export interface ApiEndpoint {
  readonly id: string;
  readonly httpMethod: HttpMethod;
  readonly routeTemplate: string;
  readonly normalizedRoute: string;
  readonly controllerName?: string;
  readonly actionName?: string;
  readonly kind: 'controller' | 'minimalApi';
  readonly filePath: string;
  readonly relativePath: string;
  readonly line: number; // 1-indexed line in source file
  readonly projectName: string;
  readonly parameters?: readonly string[];
  readonly authorization?: readonly string[];
  readonly returnType?: string;
}

export interface EndpointSearchResult {
  readonly endpoint: ApiEndpoint;
  readonly score: number;
  readonly matchReason: string;
}
