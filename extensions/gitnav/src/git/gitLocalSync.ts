import * as path from 'path';
import * as vscode from 'vscode';

import { LocalRefreshKind } from './gitPanelCoordinator';

interface GitHead { readonly name?: string; readonly commit?: string; }
interface GitRepositoryState {
  readonly HEAD?: GitHead;
  readonly indexChanges?: readonly unknown[];
  readonly workingTreeChanges?: readonly unknown[];
  readonly mergeChanges?: readonly unknown[];
  readonly onDidChange: vscode.Event<void>;
}
interface GitRepository { readonly rootUri: vscode.Uri; readonly state: GitRepositoryState; }
interface GitApi {
  readonly repositories: readonly GitRepository[];
  readonly onDidOpenRepository: vscode.Event<GitRepository>;
  readonly onDidCloseRepository: vscode.Event<GitRepository>;
}
interface GitExtensionExports { getAPI(version: 1): GitApi; }

export async function subscribeToBuiltInGitChanges(
  onChange: (root: string, kind: LocalRefreshKind) => void
): Promise<vscode.Disposable | undefined> {
  const extension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
  if (!extension) return undefined;
  const exports = extension.isActive ? extension.exports : await extension.activate();
  const api = exports?.getAPI(1);
  if (!api) return undefined;

  const subscriptions = new Map<string, vscode.Disposable>();
  const fingerprints = new Map<string, string>();
  const subscribe = (repository: GitRepository) => {
    const root = repository.rootUri.fsPath;
    const key = normalizeRoot(root);
    subscriptions.get(key)?.dispose();
    fingerprints.set(key, historyFingerprint(repository.state));
    subscriptions.set(key, repository.state.onDidChange(() => {
      const next = historyFingerprint(repository.state);
      const kind: LocalRefreshKind = fingerprints.get(key) === next ? 'status' : 'history';
      fingerprints.set(key, next);
      onChange(root, kind);
    }));
  };
  const unsubscribe = (repository: GitRepository) => {
    const key = normalizeRoot(repository.rootUri.fsPath);
    subscriptions.get(key)?.dispose();
    subscriptions.delete(key);
    fingerprints.delete(key);
  };

  api.repositories.forEach(subscribe);
  const opened = api.onDidOpenRepository(repository => { subscribe(repository); onChange(repository.rootUri.fsPath, 'history'); });
  const closed = api.onDidCloseRepository(repository => { unsubscribe(repository); onChange(repository.rootUri.fsPath, 'history'); });
  return new vscode.Disposable(() => {
    opened.dispose();
    closed.dispose();
    subscriptions.forEach(subscription => subscription.dispose());
    subscriptions.clear();
    fingerprints.clear();
  });
}

function historyFingerprint(state: GitRepositoryState): string {
  return `${state.HEAD?.name ?? ''}\0${state.HEAD?.commit ?? ''}`;
}

function normalizeRoot(root: string): string {
  const resolved = path.resolve(root);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved;
}
