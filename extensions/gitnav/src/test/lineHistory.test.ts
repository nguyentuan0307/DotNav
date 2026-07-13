import assert from 'assert/strict';
import test from 'node:test';
import { parseLineHistory, parsePatch } from '../git/lineHistory';

test('parses git log -L records with patch payload', () => {
  const output = [
    '\x011234567890abcdef\x1fAda Lovelace\x1fada@example.com\x1f1710000000\x1fRename handler',
    'diff --git a/src/Old Handler.cs b/src/New Handler.cs',
    'index 111..222 100644',
    '--- a/src/Old Handler.cs',
    '+++ b/src/New Handler.cs',
    '@@ -41,2 +45,2 @@',
    '-old',
    '+new',
    '\x01abcdef1234567890\x1fGrace Hopper\x1fgrace@example.com\x1f1720000000\x1fTouch line',
    'diff --git a/src/New Handler.cs b/src/New Handler.cs',
    '@@ -45 +45 @@',
    '+line'
  ].join('\n');

  const entries = parseLineHistory(output, '/repo', 'src/New Handler.cs');

  assert.equal(entries.length, 2);
  assert.equal(entries[0].hash, '1234567890abcdef');
  assert.equal(entries[0].shortHash, '1234567890ab');
  assert.equal(entries[0].authorName, 'Ada Lovelace');
  assert.equal(entries[0].subject, 'Rename handler');
  assert.equal(entries[0].oldPath, 'src/Old Handler.cs');
  assert.equal(entries[0].newPath, 'src/New Handler.cs');
  assert.equal(entries[0].hunks[0].header, '@@ -41,2 +45,2 @@');
  assert.deepEqual(entries[0].hunks[0].lines, [
    { kind: 'del', oldLine: 41, text: 'old' },
    { kind: 'add', newLine: 45, text: 'new' }
  ]);
});

test('parses patch hunks with real old and new line numbers', () => {
  const parsed = parsePatch([
    'diff --git a/src/File.cs b/src/File.cs',
    '@@ -10,3 +10,4 @@',
    ' context',
    '-removed',
    '+added',
    '+also added',
    ' tail',
    '\\ No newline at end of file',
    '@@ -30 +31 @@',
    '-old again',
    '+new again'
  ].join('\n'));

  assert.ok(parsed);
  assert.equal(parsed.oldPath, 'src/File.cs');
  assert.equal(parsed.newPath, 'src/File.cs');
  assert.equal(parsed.hunks.length, 2);
  assert.deepEqual(parsed.hunks[0].lines, [
    { kind: 'context', oldLine: 10, newLine: 10, text: 'context' },
    { kind: 'del', oldLine: 11, text: 'removed' },
    { kind: 'add', newLine: 11, text: 'added' },
    { kind: 'add', newLine: 12, text: 'also added' },
    { kind: 'context', oldLine: 12, newLine: 13, text: 'tail' }
  ]);
  assert.deepEqual(parsed.hunks[1].lines, [
    { kind: 'del', oldLine: 30, text: 'old again' },
    { kind: 'add', newLine: 31, text: 'new again' }
  ]);
});
