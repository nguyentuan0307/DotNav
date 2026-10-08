import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { runGit } from './gitCli';
import type { FileHistoryQuery, LineHistoryQuery } from './lineHistory';
import { mapWorktreeRangeToHead } from './lineMapping';

export class EditorHistoryContext {
  constructor(
    readonly repoRoot: string,
    readonly relPath: string,
    readonly ref: string,
    readonly label: string,
    readonly lineOffset = 0,
    readonly worktreeDiff?: string,
    readonly uncommitted = false,
    readonly sourceLineCount?: number
  ) {}

  fileQuery(): FileHistoryQuery {
    return { repoRoot: this.repoRoot, relPath: this.relPath, ref: this.ref, sourceLabel: this.label };
  }

  lineQuery(startLine: number, endLine: number, displayedContent?: string): LineHistoryQuery | undefined {
    if (this.uncommitted) return undefined;
    const start = startLine + this.lineOffset;
    const lineCount = this.sourceLineCount ?? (displayedContent === undefined
      ? undefined : contentLineCount(displayedContent) + this.lineOffset);
    if (startLine < 1 || endLine < startLine || (lineCount !== undefined && start > lineCount)) return undefined;
    const end = lineCount === undefined ? endLine + this.lineOffset : Math.min(endLine + this.lineOffset, lineCount);
    const range = this.worktreeDiff === undefined
      ? { start, end }
      : mapWorktreeRangeToHead(this.worktreeDiff, start, end);
    return range ? {
      ...this.fileQuery(),
      headStart: range.start,
      headEnd: range.end
    } : undefined;
  }

  withLineOffset(lineOffset: number, sourceContent?: string): EditorHistoryContext {
    return new EditorHistoryContext(this.repoRoot, this.relPath, this.ref, this.label,
      lineOffset, this.worktreeDiff, this.uncommitted,
      sourceContent === undefined ? this.sourceLineCount : contentLineCount(sourceContent));
  }
}

export function historyEditor(
  resource: vscode.Uri | undefined,
  activeEditor: vscode.TextEditor | undefined,
  visibleEditors: readonly vscode.TextEditor[]
): vscode.TextEditor | undefined {
  if (!resource) return activeEditor;
  const target = resource.toString();
  if (activeEditor?.document.uri.toString() === target) return activeEditor;
  return visibleEditors.find(editor => editor.document.uri.toString() === target);
}

export function revisionHistoryContext(query: string): EditorHistoryContext {
  const params = new URLSearchParams(query);
  if (params.get('empty') === 'true') {
    throw new Error('No file exists on this side of the comparison. View history from the other side.');
  }
  const root = params.get('root');
  const ref = params.get('ref');
  const filePath = params.get('path');
  if (!root || !ref || !filePath) {
    throw new Error('History context is unavailable. Reopen the comparison and try again.');
  }
  return new EditorHistoryContext(root, filePath, ref, params.get('label') || revisionLabel(ref));
}

export async function captureRevisionHistoryContext(
  repoRoot: string,
  relPath: string,
  ref: string
): Promise<EditorHistoryContext> {
  const resolved = await runGit(repoRoot, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
  if (resolved.exitCode !== 0) {
    throw new Error(resolved.stderr.trim() || `Revision ${ref} was not found.`);
  }
  let label = revisionLabel(ref);
  if (ref === 'HEAD') {
    const branch = await runGit(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    label = branch.exitCode === 0 ? branch.stdout.trim() : revisionLabel(resolved.stdout.trim());
  }
  return new EditorHistoryContext(repoRoot, relPath, resolved.stdout.trim(), label);
}

export async function captureWorktreeHistoryContext(
  repoRoot: string,
  relPath: string,
  content: string,
  lineOffset: number
): Promise<EditorHistoryContext> {
  const revision = await captureRevisionHistoryContext(repoRoot, relPath, 'HEAD');
  const base = await runGit(repoRoot, ['show', `${revision.ref}:${relPath}`]);
  const label = `Working Tree (${revision.label})`;
  if (base.exitCode !== 0) {
    const files = await runGit(repoRoot, ['ls-tree', '--name-only', '-z', revision.ref, '--', relPath]);
    if (files.exitCode === 0 && !files.stdout.split('\0').includes(relPath)) {
      return new EditorHistoryContext(repoRoot, relPath, revision.ref, label, lineOffset, undefined, true, contentLineCount(content));
    }
    throw new Error(base.stderr.trim() || 'Could not read the committed file for selection history.');
  }

  // Compare the actual editor snapshot, including unsaved changes, without writing Git objects.
  const directory = await mkdtemp(path.join(tmpdir(), 'gitnav-history-'));
  try {
    const before = path.join(directory, 'before');
    const after = path.join(directory, 'after');
    await Promise.all([
      writeFile(before, base.stdout.replace(/\r\n/g, '\n')),
      writeFile(after, content.replace(/\r\n/g, '\n'))
    ]);
    const diff = await runGit(repoRoot, [
      'diff', '--no-index', '--no-color', '--no-ext-diff', '--unified=0', '--', before, after
    ]);
    if (diff.exitCode !== 0 && diff.exitCode !== 1) {
      throw new Error(diff.stderr.trim() || 'Could not map the selection to its committed revision.');
    }
    return new EditorHistoryContext(repoRoot, relPath, revision.ref, label, lineOffset, diff.stdout, false, contentLineCount(content));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function revisionLabel(ref: string): string {
  return /^[a-f0-9]{40,64}$/i.test(ref) ? ref.slice(0, 12) : ref;
}

function contentLineCount(content: string): number {
  const lines = content.split(/\r?\n/);
  return lines.length - (lines[lines.length - 1] === '' ? 1 : 0);
}
