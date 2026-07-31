import type * as vscode from 'vscode';
import { runGit } from './gitCli';
import { GitOperationCancelledError } from './lineHistory';

export interface GitFileRevision {
  readonly hash: string;
  readonly shortHash: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly timestamp: number;
  readonly subject: string;
  readonly path: string;
  readonly ref: string;
  readonly status: string;
}

const recordSeparator = '\x1e';
const fieldSeparator = '\x1f';

export async function listFileRevisions(
  repoRoot: string,
  relPath: string,
  maxCommits: number,
  token?: vscode.CancellationToken
): Promise<GitFileRevision[]> {
  const result = await runGit(repoRoot, [
    'log',
    '--follow',
    '--find-renames',
    `--format=${recordSeparator}%H${fieldSeparator}%h${fieldSeparator}%an${fieldSeparator}%ae${fieldSeparator}%at${fieldSeparator}%s`,
    '--name-status',
    '-z',
    `--max-count=${maxCommits}`,
    '--',
    relPath
  ], token);

  if (result.cancelled) {
    throw new GitOperationCancelledError();
  }
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || 'git log failed.');
  }

  return parseFileRevisions(result.stdout, relPath);
}

export function parseFileRevisions(output: string, fallbackPath: string): GitFileRevision[] {
  return output
    .split(recordSeparator)
    .map(record => parseFileRevision(record, fallbackPath))
    .filter((revision): revision is GitFileRevision => revision !== undefined);
}

export async function resolveFileRevision(
  repoRoot: string,
  relPath: string,
  value: string,
  knownRevisions: readonly GitFileRevision[]
): Promise<GitFileRevision> {
  const resolved = await runGit(repoRoot, ['rev-parse', '--verify', `${value}^{commit}`]);
  if (resolved.exitCode !== 0) {
    throw new Error(`Revision "${value}" was not found.`);
  }

  const hash = resolved.stdout.trim();
  const known = knownRevisions.find(revision => revision.hash === hash);
  if (known) {
    return known;
  }

  const fileExists = await runGit(repoRoot, ['cat-file', '-e', `${hash}:${relPath}`]);
  if (fileExists.exitCode !== 0) {
    throw new Error(`File ${relPath} was not found at revision ${value}.`);
  }

  return {
    hash,
    shortHash: hash.slice(0, 12),
    authorName: '',
    authorEmail: '',
    timestamp: 0,
    subject: value,
    path: relPath,
    ref: hash,
    status: 'M'
  };
}

export async function readFileRevision(repoRoot: string, revision: GitFileRevision): Promise<string> {
  const result = await runGit(repoRoot, ['show', `${revision.ref}:${revision.path}`]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `File ${revision.path} was not found at ${revision.ref}.`);
  }
  return result.stdout;
}

function parseFileRevision(record: string, fallbackPath: string): GitFileRevision | undefined {
  const fields = record.split('\0');
  const header = fields[0].replace(/^\r?\n/, '');
  const [hash, shortHash, authorName, authorEmail, timestampValue, ...subjectParts] = header.split(fieldSeparator);
  if (!hash || !shortHash || subjectParts.length === 0) {
    return undefined;
  }

  const status = (fields[1] ?? '').replace(/^\r?\n/, '');
  const paths = fields.slice(2).filter(Boolean);
  const path = status.startsWith('R') || status.startsWith('C')
    ? paths[1] ?? paths[0] ?? fallbackPath
    : paths[0] ?? fallbackPath;
  const deleted = status.startsWith('D');

  return {
    hash,
    shortHash,
    authorName,
    authorEmail,
    timestamp: Number(timestampValue),
    subject: subjectParts.join(fieldSeparator),
    path,
    ref: deleted ? `${hash}^` : hash,
    status
  };
}
