import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatFullCommitInfo, parseLog, parseNameStatusZ, parseNumstatZ, parseWorkingTreeStatus, parseWorkingTreeStatusV2 } from '../git/gitPanelParsers';

test('parses delimiter-safe decorated log records and merge parents', () => {
  const output = '\x1eabc\x1fabc1234\x1fp1 p2\x1fsubject\x1fJane\x1fjane@example.com\x1f1700000000\x1fHEAD -> refs/heads/main, tag: refs/tags/v1\n';
  assert.deepEqual(parseLog(output), [{
    hash: 'abc', shortHash: 'abc1234', parents: ['p1', 'p2'], subject: 'subject', author: 'Jane',
    authorEmail: 'jane@example.com', authorTimestamp: 1700000000,
    refs: ['HEAD -> refs/heads/main', 'tag: refs/tags/v1']
  }]);
});

test('parses NUL-delimited rename and ordinary name-status records', () => {
  assert.deepEqual(parseNameStatusZ('R100\0old name.cs\0new name.cs\0M\0src/a.cs\0'), [
    { status: 'R', oldPath: 'old name.cs', path: 'new name.cs', additions: 0, deletions: 0 },
    { status: 'M', path: 'src/a.cs', additions: 0, deletions: 0, conflict: false }
  ]);
});

test('parses numstat and treats binary counts as zero', () => {
  const stats = parseNumstatZ('12\t3\tsrc/a.cs\0-\t-\timage.png\0');
  assert.deepEqual(stats.get('src/a.cs'), { additions: 12, deletions: 3 });
  assert.deepEqual(stats.get('image.png'), { additions: 0, deletions: 0 });
});

test('parses working tree conflicts and rename source paths', () => {
  assert.deepEqual(parseWorkingTreeStatus('UU src/conflict.cs\0R  src/new.cs\0src/old.cs\0'), [
    { status: 'UU', path: 'src/conflict.cs', oldPath: undefined, additions: 0, deletions: 0, conflict: true },
    { status: 'R', path: 'src/new.cs', oldPath: 'src/old.cs', additions: 0, deletions: 0, conflict: false }
  ]);
});

test('parses porcelain v2 ordinary, rename, conflict, and untracked entries', () => {
  const output = [
    '# branch.head feature',
    '1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb src/changed file.cs',
    '2 R. N... 100644 100644 100644 aaaaaaa bbbbbbb R100 src/new.cs',
    'src/old.cs',
    'u UU N... 100644 100644 100644 100644 aaaaaaa bbbbbbb ccccccc src/conflict.cs',
    '? src/new file.cs',
    '1 .. S.M. 160000 160000 160000 aaaaaaa bbbbbbb src/submodule',
    '1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb src/line\nbreak.cs',
    ''
  ].join('\0');
  assert.deepEqual(parseWorkingTreeStatusV2(output), [
    { status: 'M', path: 'src/changed file.cs', oldPath: undefined, additions: 0, deletions: 0, conflict: false },
    { status: 'R', path: 'src/new.cs', oldPath: 'src/old.cs', additions: 0, deletions: 0, conflict: false },
    { status: 'UU', path: 'src/conflict.cs', oldPath: undefined, additions: 0, deletions: 0, conflict: true },
    { status: '??', path: 'src/new file.cs', oldPath: undefined, additions: 0, deletions: 0, conflict: false },
    { status: 'M', path: 'src/submodule', oldPath: undefined, additions: 0, deletions: 0, conflict: false },
    { status: 'M', path: 'src/line\nbreak.cs', oldPath: undefined, additions: 0, deletions: 0, conflict: false }
  ]);
});

test('formats comprehensive full commit info text for clipboard', () => {
  const info = formatFullCommitInfo({
    hash: '3a4f4b269eedac470f910ccf5c4ac0d53294c596',
    shortHash: '3a4f4b2',
    author: 'Nguyen Tuan',
    authorEmail: 'tuan@example.com',
    authorTimestamp: 1700000000,
    parents: ['5c2fff0123456789'],
    subject: 'fix(gitnav): fix header button alignment',
    message: 'fix(gitnav): fix header button alignment\n\n- Fix button width collision\n- Use compact icon',
    files: [
      { path: 'media/webview/git-log.css', status: 'M', additions: 10, deletions: 2 },
      { path: 'src/git/gitLogWebviewHtml.ts', status: 'M', additions: 1, deletions: 1 }
    ]
  }, 'https://github.com/nguyentuan0307/DotNav/commit/3a4f4b2');

  assert.ok(info.includes('Commit:  3a4f4b269eedac470f910ccf5c4ac0d53294c596 (3a4f4b2)'));
  assert.ok(info.includes('Author:  Nguyen Tuan <tuan@example.com>'));
  assert.ok(info.includes('Parents: 5c2fff01'));
  assert.ok(info.includes('URL:     https://github.com/nguyentuan0307/DotNav/commit/3a4f4b2'));
  assert.ok(info.includes('- Fix button width collision'));
  assert.ok(info.includes('Changed Files (2):'));
  assert.ok(info.includes('M media/webview/git-log.css (+10, -2)'));
});

