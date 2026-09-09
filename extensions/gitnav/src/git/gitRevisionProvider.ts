import * as vscode from 'vscode';
import { GitRepositoryService } from './gitRepositoryService';

export const gitRevisionScheme = 'gitnav-revision';

export class GitRevisionProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly service: GitRepositoryService) {}
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const query = new URLSearchParams(uri.query);
    if (query.get('empty') === 'true') return '';
    const root = query.get('root');
    const ref = query.get('ref');
    const filePath = query.get('path');
    if (!root || !ref || !filePath) throw new Error('Invalid Git revision URI.');
    return (await this.service.git(root, ['show', `${ref}:${filePath}`])).stdout;
  }
}

export function revisionUri(root: string, ref: string, filePath: string): vscode.Uri {
  return vscode.Uri.from({ scheme: gitRevisionScheme, path: `/${filePath}`, query: new URLSearchParams({ root, ref, path: filePath }).toString() });
}

export function emptyRevisionUri(root: string, ref: string, filePath: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: gitRevisionScheme,
    path: `/${filePath}`,
    query: new URLSearchParams({ root, ref, path: filePath, empty: 'true' }).toString()
  });
}
