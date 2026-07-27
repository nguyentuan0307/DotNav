import assert from 'node:assert/strict';
import test from 'node:test';
import { planDatabaseUpdate } from '../ef/efDatabasePlan';

const migrations = ['Initial', 'AddOrders', 'AddInvoices'];

test('plans apply, no-op, rollback, and revert-all database actions', () => {
  assert.deepEqual(planDatabaseUpdate(migrations, new Set(['Initial']), ''), {
    label: 'Apply 2 Migrations', danger: false, valid: true, direction: 'apply', count: 2
  });
  assert.deepEqual(planDatabaseUpdate(migrations, new Set(migrations), ''), {
    label: 'Database Is Up to Date', danger: false, valid: false, direction: 'none', count: 0
  });
  assert.deepEqual(planDatabaseUpdate(migrations, new Set(migrations), 'Initial'), {
    label: 'Roll Back 2 Migrations', danger: true, valid: true, direction: 'rollback', count: 2
  });
  assert.deepEqual(planDatabaseUpdate(migrations, new Set(migrations), '0'), {
    label: 'Revert All Migrations', danger: true, valid: true, direction: 'rollback', count: 3
  });
});

test('rejects an unknown target instead of treating it as a rollback', () => {
  assert.equal(planDatabaseUpdate(migrations, new Set(['Initial']), 'Missing').valid, false);
});
