import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'node:module';
import { EventEmitter } from 'node:events';

class FakeChild extends EventEmitter {
  // No OS process is created or targeted by these tests.
  readonly pid = undefined;
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
}
let child: FakeChild;
let spawns = 0;
const loader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const original = loader._load;
loader._load = (request, parent, isMain) => request === 'child_process'
  ? { spawn: () => { spawns += 1; child = new FakeChild(); return child; } }
  : original(request, parent, isMain);
const { runProcess } = require('../ef/efProcess') as typeof import('../ef/efProcess');
loader._load = original;

test('pre-aborted process does not spawn', async () => {
  const controller = new AbortController();
  controller.abort();
  const before = spawns;
  assert.equal((await runProcess('mock', [], { cwd: '/mock', signal: controller.signal })).killed, true);
  assert.equal(spawns, before);
});

test('abort marks process killed but resolves only after its close event', async () => {
  const controller = new AbortController();
  const running = runProcess('mock', [], { cwd: '/mock', signal: controller.signal });
  let settled = false;
  void running.then(() => { settled = true; });
  controller.abort();
  await Promise.resolve();
  assert.equal(settled, false);
  child.emit('close', null);
  assert.equal((await running).killed, true);
});

test('a late abort cannot change a completed process result', async () => {
  const controller = new AbortController();
  const running = runProcess('mock', [], { cwd: '/mock', signal: controller.signal });
  child.emit('close', 0);
  controller.abort();
  assert.equal((await running).killed, false);
});
