import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bindEfActions,
  efActionDefinition,
  efActionDefinitions,
  efActionGroups
} from '../ef/efActionRegistry';

test('defines each EF Center action exactly once', () => {
  assert.equal(efActionDefinitions.length, 11);
  assert.equal(new Set(efActionDefinitions.map(action => action.id)).size, efActionDefinitions.length);
});

test('keeps the destructive EF action isolated in the danger group', () => {
  const danger = efActionGroups().get('Danger zone') ?? [];
  assert.deepEqual(danger.map(action => action.id), ['dotnav.ef.dropDatabase']);
  assert.equal(danger[0].danger, true);
});

test('resolves EF action metadata by command id', () => {
  assert.equal(efActionDefinition('dotnav.ef.generateScript')?.label, 'Generate SQL');
  assert.equal(efActionDefinition('dotnav.ef.unknown'), undefined);
});

test('binds typed execution handlers to EF action metadata', async () => {
  const executed: string[] = [];
  const handlers = Object.fromEntries(efActionDefinitions.map(action => [
    action.id,
    async () => { executed.push(action.id); }
  ])) as Parameters<typeof bindEfActions>[0];
  const actions = bindEfActions(handlers);

  await actions[0].execute();

  assert.deepEqual(executed, ['dotnav.ef.addMigration']);
});
