import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildBlameMarkdownContent,
  formatBlameText,
  formatTimeAgo,
  GitBlameEntry,
  parseGitBlamePorcelain,
  parseMultiLineGitBlamePorcelain,
  resolveBlameAutoDefault
} from '../git/inlineBlame';

test('parseMultiLineGitBlamePorcelain parses batch multi-line stream and reuses commit metadata', () => {
  const raw = [
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 2',
    'author Alice Smith',
    'author-mail <alice@example.com>',
    'author-time 1700000000',
    'author-tz +0700',
    'committer Alice Smith',
    'committer-mail <alice@example.com>',
    'committer-time 1700000000',
    'committer-tz +0700',
    'summary First commit',
    'filename src/index.ts',
    '\tline 1',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2 2',
    'filename src/index.ts',
    '\tline 2',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 10 3 1',
    'author Bob Jones',
    'author-mail <bob@example.com>',
    'author-time 1710000000',
    'author-tz +0700',
    'committer Bob Jones',
    'committer-mail <bob@example.com>',
    'committer-time 1710000000',
    'committer-tz +0700',
    'summary Second commit',
    'filename src/index.ts',
    '\tline 3'
  ].join('\n');

  const entries = parseMultiLineGitBlamePorcelain(raw);
  assert.equal(entries.length, 3);

  // Line 1
  assert.equal(entries[0].line, 1);
  assert.equal(entries[0].author, 'Alice Smith');
  assert.equal(entries[0].summary, 'First commit');

  // Line 2 - reuses Alice Smith metadata even though headers were omitted
  assert.equal(entries[1].line, 2);
  assert.equal(entries[1].author, 'Alice Smith');
  assert.equal(entries[1].summary, 'First commit');

  // Line 3 - Bob Jones
  assert.equal(entries[2].line, 3);
  assert.equal(entries[2].author, 'Bob Jones');
  assert.equal(entries[2].summary, 'Second commit');
});

test('parseGitBlamePorcelain parses standard committed porcelain output', () => {
  const raw = [
    '9bf8b9948ee87cffa3e8d76a2cda003b4f855c83 1 1 3',
    'author Alice Smith',
    'author-mail <alice@example.com>',
    'author-time 1700000000',
    'author-tz +0700',
    'committer Alice Smith',
    'committer-mail <alice@example.com>',
    'committer-time 1700000000',
    'committer-tz +0700',
    'summary feat: add user authentication controller',
    'filename src/auth/controller.ts',
    '\texport class AuthController {'
  ].join('\n');

  const entry = parseGitBlamePorcelain(raw);
  assert.ok(entry);
  assert.equal(entry.hash, '9bf8b9948ee87cffa3e8d76a2cda003b4f855c83');
  assert.equal(entry.shortHash, '9bf8b99');
  assert.equal(entry.author, 'Alice Smith');
  assert.equal(entry.authorEmail, 'alice@example.com');
  assert.equal(entry.authorTimeSeconds, 1700000000);
  assert.equal(entry.summary, 'feat: add user authentication controller');
  assert.equal(entry.line, 1);
  assert.equal(entry.isUncommitted, false);
});

test('parseGitBlamePorcelain recognizes uncommitted porcelain output', () => {
  const raw = [
    '0000000000000000000000000000000000000000 5 5 1',
    'author Not Committed Yet',
    'author-mail <not.committed.yet>',
    'author-time 1720000000',
    'author-tz +0700',
    'committer Not Committed Yet',
    'committer-mail <not.committed.yet>',
    'committer-time 1720000000',
    'committer-tz +0700',
    'summary Version of src/file.ts on worktree',
    'filename src/file.ts',
    '\tconst dirtyLine = true;'
  ].join('\n');

  const entry = parseGitBlamePorcelain(raw);
  assert.ok(entry);
  assert.equal(entry.isUncommitted, true);
  assert.equal(entry.author, 'Not Committed Yet');
  assert.equal(entry.line, 5);
});

test('parseGitBlamePorcelain safely handles empty or invalid output', () => {
  assert.equal(parseGitBlamePorcelain(''), undefined);
  assert.equal(parseGitBlamePorcelain('   \n  \n'), undefined);
  assert.equal(parseGitBlamePorcelain('fatal: no such path'), undefined);
});

test('formatTimeAgo calculates correct human-readable relative time', () => {
  const now = 1700000000;
  assert.equal(formatTimeAgo(now - 10, now), 'just now');
  assert.equal(formatTimeAgo(now - 59, now), 'just now');
  assert.equal(formatTimeAgo(now - 60, now), '1m ago');
  assert.equal(formatTimeAgo(now - 300, now), '5m ago');
  assert.equal(formatTimeAgo(now - 3600, now), '1h ago');
  assert.equal(formatTimeAgo(now - 7200, now), '2h ago');
  assert.equal(formatTimeAgo(now - 86400, now), '1d ago');
  assert.equal(formatTimeAgo(now - 86400 * 5, now), '5d ago');
  assert.equal(formatTimeAgo(now - 86400 * 45, now), '1mo ago');
  assert.equal(formatTimeAgo(now - 86400 * 400, now), '1y ago');
});

test('formatBlameText formats commit summary with You replacement and templates', () => {
  const entry: GitBlameEntry = {
    hash: 'abcdef1234567890abcdef1234567890abcdef12',
    shortHash: 'abcdef1',
    author: 'Alice Smith',
    authorEmail: 'alice@example.com',
    authorDate: new Date('2026-08-15T12:00:00Z'),
    authorTimeSeconds: 1700000000,
    summary: 'Refactor database queries',
    line: 12,
    isUncommitted: false
  };

  // Other user
  const formatted1 = formatBlameText(entry, '${author}, ${timeAgo} • ${summary}', 'Bob');
  assert.ok(formatted1.startsWith('Alice Smith, '));
  assert.ok(formatted1.includes('• Refactor database queries'));

  // Current user -> 'You'
  const formatted2 = formatBlameText(entry, '${author}, ${timeAgo} • ${summary}', 'alice smith');
  assert.ok(formatted2.startsWith('You, '));
  assert.ok(formatted2.includes('• Refactor database queries'));

  // Custom template with hash and date
  const formatted3 = formatBlameText(entry, '[${shortHash}] ${date} - ${summary}', 'Bob');
  assert.equal(formatted3, '[abcdef1] 2026-08-15 - Refactor database queries');
});

test('formatBlameText returns placeholder for uncommitted line', () => {
  const uncommitted: GitBlameEntry = {
    hash: '0000000000000000000000000000000000000000',
    shortHash: '0000000',
    author: 'Not Committed Yet',
    authorEmail: '',
    authorDate: new Date(),
    authorTimeSeconds: Math.floor(Date.now() / 1000),
    summary: 'Uncommitted changes',
    line: 1,
    isUncommitted: true
  };

  assert.equal(formatBlameText(uncommitted), 'Not committed yet');
});

test('buildBlameMarkdownContent produces rich markdown with command links', () => {
  const entry: GitBlameEntry = {
    hash: '1234567890abcdef1234567890abcdef12345678',
    shortHash: '1234567',
    author: 'Charlie',
    authorEmail: 'charlie@test.com',
    authorDate: new Date('2026-08-10T10:00:00Z'),
    authorTimeSeconds: 1700000000,
    summary: 'Fix memory leak in webview',
    line: 42,
    isUncommitted: false
  };

  const markdown = buildBlameMarkdownContent(entry, '/repo/root');

  assert.ok(markdown.includes('1234567'));
  assert.ok(markdown.includes('Fix memory leak in webview'));
  assert.ok(markdown.includes('Charlie'));
  assert.ok(markdown.includes('charlie@test.com'));
  assert.ok(markdown.includes('command:gitnav.revealCommitFromBlame'));
  assert.ok(markdown.includes('command:gitnav.copyCommitSha'));
  assert.ok(markdown.includes('command:gitnav.showHistoryForCurrentLine'));
});

test('resolveBlameAutoDefault disables by default when external blame extension is installed', () => {
  // When no user explicit setting is configured:
  assert.equal(resolveBlameAutoDefault(undefined, true), false);
  assert.equal(resolveBlameAutoDefault(undefined, false), true);

  // When user has explicitly set true or false, explicit setting always wins:
  assert.equal(resolveBlameAutoDefault(true, true), true);
  assert.equal(resolveBlameAutoDefault(true, false), true);
  assert.equal(resolveBlameAutoDefault(false, true), false);
  assert.equal(resolveBlameAutoDefault(false, false), false);
});

