import assert from 'node:assert/strict';
import test from 'node:test';
import { Deferred, EfToolsHarness, flushEfMessages } from './fixtures/efToolsHarness';
import type { EfCommandResult } from '../ef/efCli';
import type { EfDialogValues } from '../ef/efDialog';

const harness = new EfToolsHarness();
test.afterEach(async () => { await harness.close(); });

test('Update unlocks after failure while the error notification is still unanswered', async () => {
  harness.run = async () => ({ kind: 'error', stdout: '', stderr: '', errorSummary: 'Connection refused', durationMs: 1 });
  const panel = await harness.open();
  await panel.receive({ type: 'submit', values: harness.values() });
  assert.equal(panel.last('busy')?.busy, false);
  assert.equal(panel.last('validity')?.valid, true);
  assert.equal((panel.last('progress')?.progress as { state: string }).state, 'error');
  await panel.receive({ type: 'submit', values: harness.values() });
  assert.equal(panel.last('busy')?.busy, false, 'a second failure is retryable without dismissing the first notification');
});

test('changing connection/configuration/arguments or disabling invalid --add restores Update validity', async () => {
  harness.run = async () => harness.migrations(true);
  const panel = await harness.open();
  const patches: EfDialogValues[] = [{ connection: 'Database=B' }, { configuration: 'Release' }, { extraArgs: '--verbose' }];
  for (const patch of patches) {
    await panel.receive({ type: 'action', action: 'check', values: harness.values() });
    assert.equal(panel.last('validity')?.valid, false);
    await panel.receive({ type: 'change', values: harness.values(patch) });
    assert.equal(panel.last('submit')?.label, 'Update');
    assert.equal(panel.last('validity')?.valid, true);
  }
  await panel.receive({ type: 'change', values: harness.values({ add: true }) });
  assert.equal(panel.last('validity')?.valid, false);
  await panel.receive({ type: 'change', values: harness.values({ add: false }) });
  assert.equal(panel.last('submit')?.label, 'Update');
  assert.equal(panel.last('validity')?.valid, true);
});

test('failed, cancelled, malformed and unknown-applied checks never report up-to-date', async () => {
  const results: EfCommandResult[] = [
    { kind: 'error', errorSummary: 'Connection refused', stdout: '', stderr: '', durationMs: 1 },
    { kind: 'cancelled', stdout: '', stderr: '', durationMs: 1 },
    { kind: 'success', stdout: 'invalid JSON', stderr: '', durationMs: 1 },
    ...['[{}]', '[null]', '[[]]', '[{"id":"Init","applied":true},{}]'].map(stdout => ({
      kind: 'success' as const, stdout, stderr: '', durationMs: 1
    })),
    harness.migrations(null)
  ];
  for (const result of results) {
    harness.run = async () => result;
    const panel = await harness.open();
    await panel.receive({ type: 'action', action: 'check', values: harness.values() });
    assert.equal(panel.last('submit')?.label, 'Update');
    assert.equal(panel.last('validity')?.valid, true);
    assert.equal(panel.last('status')?.error, result.kind !== 'cancelled');
    assert.doesNotMatch(String(panel.last('status')?.text), /up to date/i);
    assert.equal(panel.last('busy')?.busy, false);
    await harness.close();
  }
});

test('host rejects edits and duplicate commands during Check; new connection is accepted afterwards', async () => {
  const pending = new Deferred<EfCommandResult>();
  harness.run = () => pending.promise;
  const panel = await harness.open();
  const before = harness.requests.length;
  const check = panel.receive({ type: 'action', action: 'check', values: harness.values({ connection: 'Database=A' }) });
  await flushEfMessages();
  await panel.receive({ type: 'change', values: harness.values({ connection: 'Database=B' }) });
  await panel.receive({ type: 'action', action: 'check', values: harness.values({ connection: 'Database=B' }) });
  assert.equal(harness.requests.length, before + 1);
  pending.resolve(harness.migrations(true));
  await check;
  await panel.receive({ type: 'change', values: harness.values({ connection: 'Database=B' }) });
  assert.equal(panel.last('submit')?.label, 'Update');
  assert.equal(panel.last('validity')?.valid, true);
});

test('ready replays running and completed busy/progress/label/validity without starting another command', async () => {
  const pending = new Deferred<EfCommandResult>();
  harness.run = () => pending.promise;
  const panel = await harness.open();
  const check = panel.receive({ type: 'action', action: 'check', values: harness.values() });
  await flushEfMessages();
  const before = harness.requests.length;
  panel.messages.length = 0;
  await panel.receive({ type: 'ready' });
  assert.equal(panel.last('busy')?.busy, true);
  assert.equal((panel.last('progress')?.progress as { state: string }).state, 'running');
  assert.equal(harness.requests.length, before);
  pending.resolve(harness.migrations(true));
  await check;
  panel.messages.length = 0;
  await panel.receive({ type: 'ready' });
  assert.equal(panel.last('busy')?.busy, false);
  assert.equal(panel.last('submit')?.label, 'Database Is Up to Date');
  assert.equal(panel.last('validity')?.valid, false);
  assert.equal((panel.last('progress')?.progress as { state: string }).state, 'success');
});

test('Cancel aborts the owned request, waits for it to stop, keeps the form and permits retry', async () => {
  const stopped = new Deferred<EfCommandResult>();
  let aborted = false;
  harness.run = request => {
    request.signal!.addEventListener('abort', () => { aborted = true; });
    return stopped.promise;
  };
  const panel = await harness.open();
  const submit = panel.receive({ type: 'submit', values: harness.values() });
  await flushEfMessages();
  await panel.receive({ type: 'toolbar', action: 'output' });
  assert.ok(harness.outputShows > 0);
  await panel.receive({ type: 'cancel' });
  assert.equal(aborted, true);
  assert.equal(panel.disposed, false);
  assert.equal(panel.last('busy')?.busy, true, 'do not unlock before termination');
  stopped.resolve({ kind: 'cancelled', stdout: '', stderr: '', durationMs: 1 });
  await submit;
  assert.equal(panel.last('busy')?.busy, false);
  assert.equal((panel.last('progress')?.progress as { state: string }).state, 'cancelled');
  assert.equal(panel.last('validity')?.valid, true);
  harness.run = async () => harness.migrations(false);
  await panel.receive({ type: 'action', action: 'check', values: harness.values() });
  assert.equal(panel.last('submit')?.label, 'Apply 2 Migrations');
  await panel.receive({ type: 'cancel' });
  assert.equal(panel.disposed, true);
});

test('a thrown write invalidates cached state and terminates progress without exposing credentials', async () => {
  harness.run = async () => { throw new Error('Password=supersecret'); };
  const before = harness.invalidations;
  const panel = await harness.open();
  await panel.receive({ type: 'submit', values: harness.values() });
  assert.equal(harness.invalidations, before + 1);
  assert.equal(panel.last('busy')?.busy, false);
  assert.equal((panel.last('progress')?.progress as { state: string }).state, 'error');
  assert.doesNotMatch(JSON.stringify(panel.messages), /supersecret/);
});

test('cancelling a re-check invalidates its previous up-to-date state', async () => {
  harness.run = async () => harness.migrations(true);
  const panel = await harness.open();
  await panel.receive({ type: 'action', action: 'check', values: harness.values() });
  assert.equal(panel.last('validity')?.valid, false);
  harness.run = request => new Promise(resolve => request.signal!.addEventListener('abort', () => {
    resolve({ kind: 'cancelled', stdout: '', stderr: '', durationMs: 1 });
  }));
  const check = panel.receive({ type: 'action', action: 'check', values: harness.values() });
  await flushEfMessages();
  await panel.receive({ type: 'cancel' });
  await check;
  assert.equal(panel.last('busy')?.busy, false);
  assert.equal(panel.last('submit')?.label, 'Update');
  assert.equal(panel.last('validity')?.valid, true);
  assert.equal(panel.disposed, false);
});

test('superseded project validation refreshes startup and migrations after model/startup awaits', async () => {
  const project = { ...harness.project, name: 'Other', path: '/mock/Other.csproj' };
  const model = { ...harness.model, migrations: [{ id: '20260301000000_Other', name: 'Other', filePath: '/mock/Other.cs' }] };
  harness.projects.push(project);
  harness.models.set(project.path, model);
  const originalLoader = harness.modelLoader;
  const originalResolver = harness.startupResolver;
  try {
    for (const waitingOn of ['model', 'startup']) {
      const pending = new Deferred<void>();
      harness.modelLoader = async projectPath => {
        if (waitingOn === 'model' && projectPath === project.path) { await pending.promise; }
        return originalLoader(projectPath);
      };
      harness.startupResolver = async detection => {
        if (waitingOn === 'startup' && detection.project.path === project.path) { await pending.promise; }
        return originalResolver(detection);
      };
      const panel = await harness.open();
      const values = harness.values({ project: project.path });
      const firstChange = panel.receive({ type: 'change', values });
      await flushEfMessages();
      const supersedingChange = panel.receive({ type: 'change', values: { ...values, connection: 'Database=B' } });
      pending.resolve();
      await Promise.all([firstChange, supersedingChange]);
      const startup = panel.messages.filter(message => message.type === 'options' && message.field === 'startup').at(-1);
      const target = panel.messages.filter(message => message.type === 'options' && message.field === 'target').at(-1);
      assert.equal(startup?.selected, project.path, `${waitingOn}: startup must follow the new project`);
      assert.ok(JSON.stringify(target?.options).includes('Other'), `${waitingOn}: migrations must follow the new project`);
      assert.equal(panel.last('validity')?.valid, true);
      panel.messages.length = 0;
      await panel.receive({ type: 'ready' });
      assert.equal((panel.last('values')?.values as EfDialogValues).startup, project.path);
      await harness.close();
    }
  } finally {
    harness.modelLoader = originalLoader;
    harness.startupResolver = originalResolver;
    harness.projects.pop();
    harness.models.delete(project.path);
  }
});

test('a genuine empty migration array remains a successful up-to-date check', async () => {
  harness.run = async () => ({ kind: 'success', stdout: '[]', stderr: '', durationMs: 1 });
  const panel = await harness.open();
  await panel.receive({ type: 'action', action: 'check', values: harness.values() });
  assert.equal(panel.last('submit')?.label, 'Database Is Up to Date');
  assert.equal(panel.last('validity')?.valid, false);
  assert.equal(panel.last('status')?.error, false);
});
