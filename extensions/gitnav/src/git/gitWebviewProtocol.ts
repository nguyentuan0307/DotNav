import { GitLogFilter, GitRebasePlanItem } from './gitPanelModels';
import { GitPushRecoveryStrategy } from './gitPushRecoveryPreferences';

export const gitWebviewMessageTypes = [
  'clientError',
  'ready',
  'refresh',
  'selectRepo',
  'loadLog',
  'performance',
  'detail',
  'copyText',
  'pushRecoverySettings',
  'interactiveRebase',
  'diff',
  'workingDiff',
  'openFile',
  'searchAuthors',
  'copy',
  'openConflict',
  'compare',
  'mutate',
  'context',
  'contextAction'
] as const;

export type GitWebviewMessageType = typeof gitWebviewMessageTypes[number];

export interface GitWebviewMessage {
  readonly type: GitWebviewMessageType;
  readonly root?: string;
  readonly hash?: string;
  readonly hashes?: string[];
  readonly path?: string;
  readonly ref?: string;
  readonly refs?: string[];
  readonly query?: string;
  readonly action?: string;
  readonly kind?: string;
  readonly current?: boolean;
  readonly remember?: boolean;
  readonly strategy?: GitPushRecoveryStrategy;
  readonly operation?: string;
  readonly durationMs?: number;
  readonly parent?: number;
  readonly offset?: number;
  readonly x?: number;
  readonly y?: number;
  readonly requestId?: number;
  readonly generation?: number;
  readonly filter?: GitLogFilter;
  readonly plan?: GitRebasePlanItem[];
}

const knownMessageTypes = new Set<string>(gitWebviewMessageTypes);

export function parseGitWebviewMessage(value: unknown): GitWebviewMessage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const type = (value as { readonly type?: unknown }).type;
  if (typeof type !== 'string' || !knownMessageTypes.has(type)) return undefined;
  return value as GitWebviewMessage;
}

export class GitWebviewMessageRouter {
  constructor(
    private readonly handler: (message: GitWebviewMessage) => Promise<void>,
    private readonly onRejected: (value: unknown) => void = () => undefined
  ) {}

  route(value: unknown): Promise<void> {
    const message = parseGitWebviewMessage(value);
    if (!message) {
      this.onRejected(value);
      return Promise.resolve();
    }
    return this.handler(message);
  }
}
