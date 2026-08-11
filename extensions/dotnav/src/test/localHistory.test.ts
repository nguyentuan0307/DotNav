import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { parseJournal } from '../localHistory/eventJournal';
import { automaticCaptureDelay, createLocalHistoryPolicy, shouldTrackFile } from '../localHistory/historyPolicy';
import {
  LocalHistoryStore,
  retainNewestSnapshotsPerFile,
  retainWithinStorageLimit
} from '../localHistory/localHistoryStore';
import { LocalHistoryEvent, LocalHistoryRevision } from '../localHistory/localHistoryTypes';
import { createLocalHistoryPatch } from '../localHistory/localHistoryDiff';
import { renderLocalHistoryPanelHtml } from '../localHistory/localHistoryPanelHtml';
import { buildFileHistoryEntries, buildSelectionHistoryEntries } from '../localHistory/localHistoryQuery';

test('Local History policy tracks supported workspace text files only', () => {
  const root = path.resolve('/workspace');
  const policy = createLocalHistoryPolicy({ enabled: true });

  assert.equal(shouldTrackFile(path.join(root, 'src', 'Program.cs'), [root], policy), true);
  assert.equal(shouldTrackFile(path.join(root, 'obj', 'Program.cs'), [root], policy), false);
  assert.equal(shouldTrackFile(path.resolve('/other/Program.cs'), [root], policy), false);
  assert.equal(shouldTrackFile(path.join(root, 'image.png'), [root], policy), false);
  assert.equal(policy.maximumStorageBytes, 250 * 1024 * 1024);
  assert.equal(policy.maximumRevisionsPerFile, 250);
  assert.equal(policy.snapshotCoalescingMs, 5000);
});

test('Local History is disabled by default', () => {
  const root = path.resolve('/workspace');
  const policy = createLocalHistoryPolicy();

  assert.equal(policy.enabled, false);
  assert.equal(shouldTrackFile(path.join(root, 'Program.cs'), [root], policy), false);
});

test('automatic snapshots are coalesced into the configured window', () => {
  assert.equal(automaticCaptureDelay(10_000, 0, 5_000), 0);
  assert.equal(automaticCaptureDelay(12_000, 10_000, 5_000), 3_000);
  assert.equal(automaticCaptureDelay(15_000, 10_000, 5_000), 0);
});

test('Event journal ignores an incomplete final record', () => {
  const valid = event({ id: 'one', contentHash: 'hash-one' });
  const parsed = parseJournal(`${JSON.stringify(valid)}\n{"id":"incomplete`);

  assert.deepEqual(parsed, [valid]);
});

test('Local History store deduplicates content and follows a rename', async () => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dotnav-local-history-'));
  try {
    const store = new LocalHistoryStore(storageRoot);
    await store.initialize(5, 10 * 1024 * 1024);
    const originalPath = path.join(storageRoot, 'Program.cs');
    const renamedPath = path.join(storageRoot, 'App.cs');

    await store.snapshot(originalPath, Buffer.from('class Program {}'), 'save');
    await store.snapshot(originalPath, Buffer.from('class Program {}'), 'save');
    await store.recordRename(originalPath, renamedPath, 'external');
    await store.snapshot(renamedPath, Buffer.from('class App {}'), 'save');

    const revisions = store.getRevisions(renamedPath);
    assert.equal(revisions.length, 2);
    assert.equal((await store.readRevision(revisions[0])).toString(), 'class App {}');
    assert.equal((await store.readRevision(revisions[1])).toString(), 'class Program {}');
  } finally {
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
});

test('Storage limit removes the oldest uniquely referenced content first', () => {
  const events = [
    event({ id: 'one', timestamp: 1, contentHash: 'hash-one' }),
    event({ id: 'two', timestamp: 2, contentHash: 'hash-two' }),
    event({ id: 'three', timestamp: 3, contentHash: 'hash-three' })
  ];

  const retained = retainWithinStorageLimit(events, new Map([
    ['hash-one', 10], ['hash-two', 10], ['hash-three', 10]
  ]), 20);

  assert.deepEqual(retained.map(item => item.id), ['two', 'three']);
});

test('per-file retention keeps only the newest snapshot budget', () => {
  const events = [
    event({ id: 'a1', fileId: 'a', timestamp: 1 }),
    event({ id: 'b1', fileId: 'b', timestamp: 2 }),
    event({ id: 'a2', fileId: 'a', timestamp: 3 }),
    event({ id: 'a3', fileId: 'a', timestamp: 4 }),
    event({ id: 'b2', fileId: 'b', timestamp: 5 })
  ];

  const retained = retainNewestSnapshotsPerFile(events, 2);

  assert.deepEqual(retained.map(item => item.id), ['b1', 'a2', 'a3', 'b2']);
});

test('storage retention handles a large event journal in one pass', () => {
  const events = Array.from({ length: 50_000 }, (_, index) => event({
    id: `event-${index}`,
    timestamp: index,
    contentHash: `hash-${index}`
  }));
  const sizes = new Map(events.map(item => [item.contentHash!, 1]));

  const retained = retainWithinStorageLimit(events, sizes, 10_000);

  assert.equal(retained.length, 10_000);
  assert.equal(retained[0].id, 'event-40000');
});

test('store retains one internal baseline beyond the visible revision budget', async () => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dotnav-local-history-budget-'));
  try {
    const store = new LocalHistoryStore(storageRoot);
    await store.initialize(5, 10 * 1024 * 1024, 2);
    const filePath = path.join(storageRoot, 'Program.cs');
    for (let index = 1; index <= 5; index++) {
      await store.snapshot(filePath, Buffer.from(`version ${index}`), 'save');
    }

    await store.prune(5, 10 * 1024 * 1024, 2);
    const revisions = store.getRevisions(filePath);

    assert.equal(revisions.length, 3);
    assert.equal(buildFileHistoryEntries(revisions).length, 2);
  } finally {
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
});

test('Local History is exposed through the Local changes context submenu', () => {
  const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  const submenu = manifest.contributes.submenus.find((item: { id: string }) =>
    item.id === 'dotnav.localChanges');
  const entries = manifest.contributes.menus['dotnav.localChanges'];
  const treeAnchor = manifest.contributes.menus['view/item/context'].find((item: { submenu?: string }) =>
    item.submenu === 'dotnav.localChanges');

  assert.equal(submenu.label, 'Local changes');
  assert.deepEqual(entries.map((item: { command: string }) => item.command), [
    'dotnav.localHistory.show',
    'dotnav.localHistory.showSelection'
  ]);
  assert.match(entries[1].when, /editorHasSelection/);
  assert.match(treeAnchor.when, /viewItem =~ \/file\//);
  const properties = manifest.contributes.configuration.properties;
  assert.equal(properties['dotnav.localHistory.enabled'].default, false);
  assert.equal(properties['dotnav.localHistory.maximumStorageMb'].default, 250);
  assert.equal(properties['dotnav.localHistory.maximumRevisionsPerFile'].default, 250);
  assert.equal(properties['dotnav.localHistory.snapshotCoalescingSeconds'].default, 5);
});

test('Local History diff creates numbered replacement hunks', () => {
  const hunks = createLocalHistoryPatch(
    'line one\nold value\nline three\n',
    'line one\nnew value\nline three\n'
  );

  assert.equal(hunks.length, 1);
  assert.equal(hunks[0].header, '@@ -1,3 +1,3 @@');
  assert.deepEqual(hunks[0].lines.map(line => [line.kind, line.oldLine, line.newLine, line.text]), [
    ['context', 1, 1, 'line one'],
    ['del', 2, undefined, 'old value'],
    ['add', undefined, 2, 'new value'],
    ['context', 3, 3, 'line three']
  ]);
});

test('Local History diff splits distant changes into separate hunks', () => {
  const previous = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
  const revision = [...previous];
  revision[1] = 'changed 2';
  revision[18] = 'changed 19';

  const hunks = createLocalHistoryPatch(previous.join('\n'), revision.join('\n'), 2);

  assert.equal(hunks.length, 2);
  assert.ok(hunks.every(hunk => hunk.lines.some(line => line.kind === 'add')));
});

test('oldest Local History revision is rendered as a file addition', () => {
  const hunks = createLocalHistoryPatch('', 'first\nsecond\n');

  assert.equal(hunks[0].header, '@@ -0,0 +1,2 @@');
  assert.deepEqual(hunks[0].lines.map(line => line.kind), ['add', 'add']);
});

test('Local History webview escapes state and applies a nonce CSP', () => {
  const html = renderLocalHistoryPanelHtml({
    fileName: '</script><script>bad()</script>.cs',
    filePath: '/workspace/</script><script>bad()</script>.cs',
    scopeLabel: 'File history',
    revisions: [{
      id: 'revision-1',
      timestamp: 123,
      source: 'save',
      path: '/workspace/Program.cs'
    }]
  }, 'test-nonce');

  assert.match(html, /script-src 'nonce-test-nonce'/);
  assert.match(html, /<script nonce="test-nonce">/);
  assert.doesNotMatch(html, /<script>bad\(\)<\/script>/);
  assert.match(html, /aria-label="Local History revisions"/);
});

test('generated Local History webview JavaScript is syntactically valid', () => {
  const html = renderLocalHistoryPanelHtml({
    fileName: 'Program.cs',
    filePath: '/workspace/Program.cs',
    scopeLabel: 'File history',
    revisions: []
  }, 'syntax-nonce');
  const script = /<script nonce="syntax-nonce">([\s\S]*?)<\/script>/.exec(html)?.[1];

  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

test('Selection Local History excludes revisions that only change other lines', async () => {
  const revisions = [
    revision('newest', 3),
    revision('middle', 2),
    revision('oldest', 1)
  ];
  const contents = new Map([
    ['newest', 'one\nchanged selection\nthree\nunrelated newest\n'],
    ['middle', 'one\nselected line\nthree\nunrelated newest\n'],
    ['oldest', 'one\nselected line\nthree\nunrelated old\n']
  ]);

  const entries = await buildSelectionHistoryEntries(
    revisions,
    { startLine: 2, endLine: 2 },
    item => Promise.resolve(contents.get(item.event.id)!)
  );

  assert.deepEqual(entries.map(item => item.revision.event.id), ['newest']);
});

test('Selection Local History maps a range backward through inserted lines', async () => {
  const revisions = [
    revision('changed-target', 3),
    revision('inserted-above', 2),
    revision('original', 1)
  ];
  const contents = new Map([
    ['changed-target', 'inserted\none\nTARGET changed\nthree\n'],
    ['inserted-above', 'inserted\none\ntarget\nthree\n'],
    ['original', 'one\ntarget\nthree\n']
  ]);

  const entries = await buildSelectionHistoryEntries(
    revisions,
    { startLine: 3, endLine: 3 },
    item => Promise.resolve(contents.get(item.event.id)!)
  );

  assert.deepEqual(entries.map(item => item.revision.event.id), ['changed-target']);
});

test('Selection Local History stops before a selected range was introduced', async () => {
  const revisions = [revision('introduced', 2), revision('original', 1)];
  const contents = new Map([
    ['introduced', 'one\nnew selected line\ntwo\n'],
    ['original', 'one\ntwo\n']
  ]);

  const entries = await buildSelectionHistoryEntries(
    revisions,
    { startLine: 2, endLine: 2 },
    item => Promise.resolve(contents.get(item.event.id)!)
  );

  assert.deepEqual(entries.map(item => item.revision.event.id), ['introduced']);
});

test('File Local History keeps the initial baseline internal', () => {
  const baseline = revision('baseline', 1, 'baseline');
  const saved = revision('saved', 2, 'save');

  assert.deepEqual(buildFileHistoryEntries([baseline]), []);
  assert.deepEqual(
    buildFileHistoryEntries([saved, baseline]).map(item => item.revision.event.id),
    ['saved']
  );
});

test('Selection Local History maps past a deletion immediately above one selected line', async () => {
  const revisions = [revision('deleted-above', 2), revision('original', 1)];
  const contents = new Map([
    ['deleted-above', 'one\nselected\n'],
    ['original', 'one\ndeleted\nselected\n']
  ]);

  const entries = await buildSelectionHistoryEntries(
    revisions,
    { startLine: 2, endLine: 2 },
    item => Promise.resolve(contents.get(item.event.id)!)
  );

  assert.deepEqual(entries, []);
});

function event(overrides: Partial<LocalHistoryEvent>): LocalHistoryEvent {
  return {
    id: 'event',
    fileId: 'file',
    kind: 'snapshot',
    timestamp: Date.now(),
    path: '/workspace/Program.cs',
    source: 'save',
    ...overrides
  };
}

function revision(
  id: string,
  timestamp: number,
  source: LocalHistoryEvent['source'] = 'save'
): LocalHistoryRevision {
  return {
    event: event({ id, timestamp, contentHash: `hash-${id}`, source }),
    displayPath: '/workspace/Program.cs'
  };
}
