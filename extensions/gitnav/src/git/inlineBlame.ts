import type * as vscode from 'vscode';
import { BoundedCache } from './boundedCache';
import { runGit } from './gitCli';

export interface GitBlameEntry {
  readonly hash: string;
  readonly shortHash: string;
  readonly author: string;
  readonly authorEmail: string;
  readonly authorDate: Date;
  readonly authorTimeSeconds: number;
  readonly summary: string;
  readonly line: number;
  readonly isUncommitted: boolean;
}

export function parseGitBlamePorcelain(rawOutput: string): GitBlameEntry | undefined {
  if (!rawOutput || rawOutput.trim().length === 0) {
    return undefined;
  }

  const lines = rawOutput.split(/\r?\n/);
  if (lines.length === 0) {
    return undefined;
  }

  const headerMatch = lines[0].match(/^([0-9a-fA-F]{40})\s+(\d+)\s+(\d+)/);
  if (!headerMatch) {
    return undefined;
  }

  const hash = headerMatch[1];
  const isUncommitted = /^0+$/.test(hash);
  const line = parseInt(headerMatch[3], 10);

  let author = 'Unknown';
  let authorMail = '';
  let authorTimeSeconds = 0;
  let summary = '';

  for (let i = 1; i < lines.length; i++) {
    const lineContent = lines[i];
    if (lineContent.startsWith('\t')) {
      // Reached source code line
      break;
    }

    if (lineContent.startsWith('author ')) {
      author = lineContent.substring(7).trim();
    } else if (lineContent.startsWith('author-mail ')) {
      authorMail = lineContent.substring(12).trim().replace(/^<|>$/g, '');
    } else if (lineContent.startsWith('author-time ')) {
      authorTimeSeconds = parseInt(lineContent.substring(12).trim(), 10) || 0;
    } else if (lineContent.startsWith('summary ')) {
      summary = lineContent.substring(8).trim();
    }
  }

  if (isUncommitted || author === 'Not Committed Yet') {
    return {
      hash: '0000000000000000000000000000000000000000',
      shortHash: '0000000',
      author: 'Not Committed Yet',
      authorEmail: '',
      authorDate: new Date(),
      authorTimeSeconds: Math.floor(Date.now() / 1000),
      summary: 'Uncommitted changes',
      line,
      isUncommitted: true
    };
  }

  return {
    hash,
    shortHash: hash.substring(0, 7),
    author,
    authorEmail: authorMail,
    authorDate: new Date(authorTimeSeconds * 1000),
    authorTimeSeconds,
    summary,
    line,
    isUncommitted: false
  };
}

export function formatTimeAgo(timestampSeconds: number, nowSeconds: number = Math.floor(Date.now() / 1000)): string {
  const diff = Math.max(0, nowSeconds - timestampSeconds);
  if (diff < 60) {
    return 'just now';
  }
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(diff / 3600);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(diff / 86400);
  if (days < 30) {
    return `${days}d ago`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months}mo ago`;
  }
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

export function formatBlameText(
  entry: GitBlameEntry,
  template: string = '${author}, ${timeAgo} • ${summary}',
  currentUser?: string
): string {
  if (entry.isUncommitted) {
    return 'Not committed yet';
  }

  const isCurrentAuthor = Boolean(currentUser && entry.author.toLowerCase() === currentUser.toLowerCase());
  const authorDisplay = isCurrentAuthor ? 'You' : entry.author;
  const timeAgo = formatTimeAgo(entry.authorTimeSeconds);
  const dateStr = entry.authorDate.toISOString().split('T')[0];

  return template
    .replace(/\$\{author\}/g, authorDisplay)
    .replace(/\$\{timeAgo\}/g, timeAgo)
    .replace(/\$\{date\}/g, dateStr)
    .replace(/\$\{summary\}/g, entry.summary)
    .replace(/\$\{hash\}/g, entry.hash)
    .replace(/\$\{shortHash\}/g, entry.shortHash);
}

export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+!|]/g, '\\$&');
}

export function resolveBlameAutoDefault(
  explicitConfigValue: boolean | undefined,
  hasExternalBlameExtension: boolean
): boolean {
  if (explicitConfigValue !== undefined) {
    return explicitConfigValue;
  }
  return !hasExternalBlameExtension;
}

export function buildBlameMarkdownContent(entry: GitBlameEntry, repoRoot: string): string {
  if (entry.isUncommitted) {
    return `**Not committed yet**\n\n*Working tree changes on this line have not been committed.*`;
  }

  const revealArgs = encodeURIComponent(JSON.stringify([repoRoot, entry.hash]));
  const copyArgs = encodeURIComponent(JSON.stringify([entry.hash]));

  return [
    `### \`$(git-commit) ${entry.shortHash}\` — ${escapeMarkdown(entry.summary)}`,
    '',
    `**Author:** ${escapeMarkdown(entry.author)}${entry.authorEmail ? ` &lt;${escapeMarkdown(entry.authorEmail)}&gt;` : ''}`,
    '',
    `**Date:** ${entry.authorDate.toLocaleString()} (${formatTimeAgo(entry.authorTimeSeconds)})`,
    '',
    '---',
    '',
    `[$(search) Reveal in Git Log](command:gitnav.revealCommitFromBlame?${revealArgs} "Reveal in Git Log") &nbsp;|&nbsp; [$(clippy) Copy SHA](command:gitnav.copyCommitSha?${copyArgs} "Copy commit hash") &nbsp;|&nbsp; [$(history) Line History](command:gitnav.showHistoryForCurrentLine "View line history")`
  ].join('\n');
}

export async function fetchLineBlame(
  repoRoot: string,
  relPath: string,
  lineNumber: number,
  cache: BoundedCache<GitBlameEntry>,
  token?: vscode.CancellationToken
): Promise<GitBlameEntry | undefined> {
  const cacheKey = `${relPath}:${lineNumber}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const result = await runGit(
    repoRoot,
    ['blame', '--porcelain', '-L', `${lineNumber},${lineNumber}`, '--', relPath],
    token
  );

  if (result.exitCode !== 0 || token?.isCancellationRequested) {
    return undefined;
  }

  const entry = parseGitBlamePorcelain(result.stdout);
  if (entry) {
    cache.set(cacheKey, entry);
  }
  return entry;
}
