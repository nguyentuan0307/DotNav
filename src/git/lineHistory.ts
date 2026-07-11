import * as path from 'path';
import * as vscode from 'vscode';
import { runGit } from './gitCli';

export type PatchLineKind = 'context' | 'add' | 'del';

export interface PatchLine {
  readonly kind: PatchLineKind;
  readonly oldLine?: number;
  readonly newLine?: number;
  readonly text: string;
}

export interface PatchHunk {
  readonly header: string;
  readonly lines: PatchLine[];
}

export interface LineHistoryEntry {
  readonly hash: string;
  readonly shortHash: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly timestamp: number;
  readonly subject: string;
  readonly oldPath: string;
  readonly newPath: string;
  readonly hunks: PatchHunk[];
  readonly repoRoot: string;
}

export interface LineHistoryQuery {
  readonly repoRoot: string;
  readonly relPath: string;
  readonly headStart: number;
  readonly headEnd: number;
}

export class GitOperationCancelledError extends Error {
  constructor() {
    super('Git operation cancelled.');
  }
}

const recordSeparator = '\x01';
const fieldSeparator = '\x1f';

export async function getLineHistory(
  query: LineHistoryQuery,
  maxCommits: number,
  token?: vscode.CancellationToken
): Promise<LineHistoryEntry[]> {
  const result = await runGit(query.repoRoot, [
    'log',
    '-L',
    `${query.headStart},${query.headEnd}:${query.relPath}`,
    `--format=${recordSeparator}%H${fieldSeparator}%an${fieldSeparator}%ae${fieldSeparator}%at${fieldSeparator}%s`,
    `--max-count=${maxCommits}`,
    '--no-color'
  ], token);

  if (result.exitCode !== 0) {
    if (result.cancelled) {
      throw new GitOperationCancelledError();
    }

    throw new Error(result.stderr.trim() || 'git log failed.');
  }

  return parseLineHistory(result.stdout, query.repoRoot, query.relPath);
}

export function parseLineHistory(output: string, repoRoot: string, fallbackPath: string): LineHistoryEntry[] {
  return output
    .split(recordSeparator)
    .filter(part => part.trim().length > 0)
    .map(part => parseRecord(part, repoRoot, fallbackPath))
    .filter((entry): entry is LineHistoryEntry => entry !== undefined);
}

export async function hasParentCommit(repoRoot: string, hash: string, token?: vscode.CancellationToken): Promise<boolean> {
  const result = await runGit(repoRoot, ['rev-parse', '--verify', `${hash}^`], token);
  return result.exitCode === 0;
}

function parseRecord(record: string, repoRoot: string, fallbackPath: string): LineHistoryEntry | undefined {
  const firstLineEnd = record.indexOf('\n');
  const header = firstLineEnd >= 0 ? record.slice(0, firstLineEnd) : record;
  const patch = firstLineEnd >= 0 ? record.slice(firstLineEnd + 1).trimEnd() : '';
  const fields = header.split(fieldSeparator);
  if (fields.length < 5) {
    return undefined;
  }

  const [hash, authorName, authorEmail, timestampValue, ...subjectParts] = fields;
  const parsedPatch = parsePatch(patch);
  const parsedPaths = parsedPatch ?? parseDiffPaths(patch);
  const newPath = parsedPaths?.newPath ?? fallbackPath;

  return {
    hash,
    shortHash: hash.slice(0, 12),
    authorName,
    authorEmail,
    timestamp: Number(timestampValue),
    subject: subjectParts.join(fieldSeparator),
    oldPath: parsedPaths?.oldPath ?? newPath,
    newPath,
    hunks: parsedPatch?.hunks ?? [],
    repoRoot
  };
}

export function parsePatch(patch: string): { oldPath: string; newPath: string; hunks: PatchHunk[] } | undefined {
  const paths = parseDiffPaths(patch);
  if (!paths) {
    return undefined;
  }

  return {
    ...paths,
    hunks: parsePatchHunks(patch)
  };
}

function parseDiffPaths(patch: string): { oldPath: string; newPath: string } | undefined {
  const line = patch.split(/\r?\n/).find(candidate => candidate.startsWith('diff --git '));
  if (!line) {
    return undefined;
  }

  const args = splitGitDiffHeader(line.slice('diff --git '.length));
  if (args.length < 2) {
    return undefined;
  }

  return {
    oldPath: stripDiffPrefix(args[0]),
    newPath: stripDiffPrefix(args[1])
  };
}

function splitGitDiffHeader(value: string): string[] {
  if (!value.startsWith('"')) {
    const newPathMarker = ' b/';
    const markerIndex = value.indexOf(newPathMarker);
    if (markerIndex > 0) {
      return [value.slice(0, markerIndex), value.slice(markerIndex + 1)];
    }
  }

  const result: string[] = [];
  let current = '';
  let quoted = false;
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && quoted) {
      escaped = true;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === ' ' && !quoted) {
      if (current.length > 0) {
        result.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    result.push(current);
  }

  return result;
}

function stripDiffPrefix(value: string): string {
  if (value === '/dev/null') {
    return value;
  }

  return value.replace(/^[ab]\//, '');
}

function parsePatchHunks(patch: string): PatchHunk[] {
  const hunks: PatchHunk[] = [];
  let current: { header: string; lines: PatchLine[]; oldLine: number; newLine: number } | undefined;

  for (const line of patch.split(/\r?\n/)) {
    const header = parseHunkHeader(line);
    if (header) {
      current = {
        header: line,
        lines: [],
        oldLine: header.oldStart,
        newLine: header.newStart
      };
      hunks.push(current);
      continue;
    }

    if (!current || line.length === 0 || line.startsWith('\\ No newline at end of file')) {
      continue;
    }

    const prefix = line[0];
    const text = line.slice(1);
    if (prefix === ' ') {
      current.lines.push({
        kind: 'context',
        oldLine: current.oldLine,
        newLine: current.newLine,
        text
      });
      current.oldLine += 1;
      current.newLine += 1;
    } else if (prefix === '-') {
      current.lines.push({
        kind: 'del',
        oldLine: current.oldLine,
        text
      });
      current.oldLine += 1;
    } else if (prefix === '+') {
      current.lines.push({
        kind: 'add',
        newLine: current.newLine,
        text
      });
      current.newLine += 1;
    }
  }

  return hunks;
}

function parseHunkHeader(line: string): { oldStart: number; newStart: number } | undefined {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if (!match) {
    return undefined;
  }

  return {
    oldStart: Number(match[1]),
    newStart: Number(match[2])
  };
}

export function lineHistoryLabel(query: LineHistoryQuery): string {
  return `${path.basename(query.relPath)}:${query.headStart}-${query.headEnd}`;
}
