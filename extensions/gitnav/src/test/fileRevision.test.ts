import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFileRevisions } from '../git/fileRevision';

test('parses modified, renamed, and deleted file revisions', () => {
  const output = [
    '\x1e1111111111111111111111111111111111111111\x1f1111111\x1fAda\x1fada@example.com\x1f1710000000\x1fModify file',
    '\0\nM\0src/New.cs\0',
    '\x1e2222222222222222222222222222222222222222\x1f2222222\x1fGrace\x1fgrace@example.com\x1f1700000000\x1fRename file',
    '\0\nR100\0src/Old.cs\0src/New.cs\0',
    '\x1e3333333333333333333333333333333333333333\x1f3333333\x1fLinus\x1flinus@example.com\x1f1690000000\x1fDelete file',
    '\0\nD\0src/Old.cs\0'
  ].join('');

  const revisions = parseFileRevisions(output, 'src/New.cs');

  assert.equal(revisions.length, 3);
  assert.deepEqual(
    revisions.map(revision => ({
      hash: revision.hash,
      path: revision.path,
      ref: revision.ref,
      status: revision.status
    })),
    [
      {
        hash: '1111111111111111111111111111111111111111',
        path: 'src/New.cs',
        ref: '1111111111111111111111111111111111111111',
        status: 'M'
      },
      {
        hash: '2222222222222222222222222222222222222222',
        path: 'src/New.cs',
        ref: '2222222222222222222222222222222222222222',
        status: 'R100'
      },
      {
        hash: '3333333333333333333333333333333333333333',
        path: 'src/Old.cs',
        ref: '3333333333333333333333333333333333333333^',
        status: 'D'
      }
    ]
  );
});
