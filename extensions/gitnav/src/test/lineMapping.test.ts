import assert from 'assert/strict';
import test from 'node:test';
import { mapWorktreeRangeToHead } from '../git/lineMapping';

test('maps clean ranges without hunks', () => {
  assert.deepEqual(mapWorktreeRangeToHead('', 10, 12), { start: 10, end: 12 });
});

test('parses hunk headers with missing counts as one line', () => {
  const diff = '@@ -25 +25 @@\n-old\n+new\n';
  assert.equal(mapWorktreeRangeToHead(diff, 25, 25), undefined);
  assert.deepEqual(mapWorktreeRangeToHead(diff, 26, 26), { start: 26, end: 26 });
});

test('returns undefined for lines inserted only in worktree', () => {
  const diff = '@@ -38,0 +39,13 @@\n+new\n';
  assert.equal(mapWorktreeRangeToHead(diff, 39, 51), undefined);
});

test('applies cumulative delta after multiple hunks', () => {
  const diff = [
    '@@ -10,0 +11,2 @@',
    '+a',
    '+b',
    '@@ -30,4 +32,1 @@',
    '-old',
    '-old',
    '-old',
    '-old',
    '+new'
  ].join('\n');

  assert.deepEqual(mapWorktreeRangeToHead(diff, 40, 40), { start: 41, end: 41 });
});

test('keeps committed parts when a selection partially overlaps new lines', () => {
  const diff = '@@ -38,0 +39,2 @@\n+new\n+new\n';
  assert.deepEqual(mapWorktreeRangeToHead(diff, 38, 42), { start: 38, end: 40 });
});
