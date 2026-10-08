import assert from 'node:assert/strict';
import test from 'node:test';
import type * as vscode from 'vscode';
import { EditorHistoryContext, historyEditor, revisionHistoryContext } from '../git/editorHistoryContext';
import { fileHistoryLabel, lineHistoryLabel } from '../git/lineHistory';

function editor(uri: string): vscode.TextEditor {
  return { document: { uri: { toString: () => uri } } } as vscode.TextEditor;
}

test('history uses the context-menu URI even when the other diff side has focus', () => {
  const left = editor('gitnav-revision:/File.cs?ref=feature');
  const right = editor('file:/repo/File.cs');
  const resource = left.document.uri;
  assert.equal(historyEditor(resource, right, [left, right]), left);
  assert.equal(historyEditor(undefined, right, [left, right]), right);
  assert.equal(historyEditor(resource, right, [right]), undefined);
});

test('history preserves the active selection when the same document is visible twice', () => {
  const first = editor('file:/repo/File.cs');
  const focused = editor('file:/repo/File.cs');
  assert.equal(historyEditor(first.document.uri, focused, [first, focused]), focused);
});

test('revision history keeps repository, branch label and renamed path from the selected side', () => {
  const ref = 'a'.repeat(40);
  const context = revisionHistoryContext(new URLSearchParams({
    root: '/other/repository', ref, path: 'src/Old File.cs', label: 'origin/feature'
  }).toString());
  assert.deepEqual(context.fileQuery(), {
    repoRoot: '/other/repository', relPath: 'src/Old File.cs', ref, sourceLabel: 'origin/feature'
  });
  assert.equal(fileHistoryLabel(context.fileQuery()), 'src/Old File.cs · origin/feature');
  assert.equal(lineHistoryLabel(context.lineQuery(4, 6)!), 'Old File.cs:4-6 · origin/feature');
  assert.equal(revisionHistoryContext(new URLSearchParams({
    root: '/repo', ref, path: 'File.cs'
  }).toString()).label, 'a'.repeat(12));
});

test('empty or missing revision context never falls back to the current branch', () => {
  assert.throws(() => revisionHistoryContext('root=/repo&ref=main&path=File.cs&empty=true'), /No file exists/);
  for (const query of ['', 'root=/repo&path=File.cs', 'ref=main&path=File.cs', 'root=/repo&ref=main']) {
    assert.throws(() => revisionHistoryContext(query), /Reopen the comparison/);
  }
});

test('snippet history uses original line numbers and the saved worktree mapping', () => {
  const revision = new EditorHistoryContext('/repo', 'File.cs', 'feature-sha', 'feature');
  const snippet = revision.withLineOffset(40);
  assert.equal(snippet.lineQuery(1, 3)?.headStart, 41);
  assert.equal(snippet.lineQuery(1, 3)?.headEnd, 43);
  assert.equal(snippet.fileQuery().ref, 'feature-sha');

  const worktree = new EditorHistoryContext('/repo', 'File.cs', 'main-sha', 'Working Tree (main)',
    40, '@@ -39,0 +40,2 @@\n+new\n+new again\n');
  assert.equal(worktree.lineQuery(1, 1), undefined);
  assert.equal(worktree.lineQuery(2, 4)?.headStart, 40);
  assert.equal(worktree.lineQuery(2, 4)?.headEnd, 42);
  assert.equal(worktree.lineQuery(2, 4)?.ref, 'main-sha');
  const uncommitted = new EditorHistoryContext('/repo', 'New.cs', 'main-sha', 'main', 0, undefined, true);
  assert.equal(uncommitted.lineQuery(1, 2), undefined);
});

test('shorter branch snippets and the final editor-only line cannot query past the source EOF', () => {
  const revision = new EditorHistoryContext('/repo', 'File.cs', 'feature-sha', 'feature');
  const beyondEnd = revision.withLineOffset(4, 'first\nsecond\n');
  assert.equal(beyondEnd.lineQuery(1, 1, ''), undefined);
  assert.equal(beyondEnd.fileQuery().ref, 'feature-sha');
  assert.equal(revision.lineQuery(1, 1, ''), undefined);
  assert.equal(revision.lineQuery(3, 3, 'first\nsecond\n'), undefined);

  const tail = revision.withLineOffset(1, 'first\nsecond\n');
  assert.equal(tail.lineQuery(2, 2, 'second\n'), undefined);
  assert.equal(tail.lineQuery(1, 2, 'second\n')?.headEnd, 2);
  assert.equal(revision.lineQuery(1, 3, 'first\nsecond\n')?.headEnd, 2);
});

test('a snippet containing one real empty source line still has line history', () => {
  const emptyLine = new EditorHistoryContext('/repo', 'File.cs', 'feature-sha', 'feature')
    .withLineOffset(1, 'first\n\nthird\n');
  assert.equal(emptyLine.lineQuery(1, 1, '')?.headStart, 2);
  assert.equal(emptyLine.lineQuery(1, 1, '')?.headEnd, 2);
});
