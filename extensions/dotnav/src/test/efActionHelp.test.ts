import assert from 'node:assert/strict';
import test from 'node:test';
import { EF_ACTION_HELP, actionHelpFor } from '../ef/efActionHelp';
import { hasVietnameseTranslation, localizeEfText } from '../ef/efDialogI18n';

const actionIds = [
  'dotnav.ef.addMigration',
  'dotnav.ef.removeLastMigration',
  'dotnav.ef.listMigrations',
  'dotnav.ef.updateDatabase',
  'dotnav.ef.pendingModelChanges',
  'dotnav.ef.dbContextInfo',
  'dotnav.ef.generateScript',
  'dotnav.ef.migrationsBundle',
  'dotnav.ef.optimizeDbContext',
  'dotnav.ef.dropDatabase'
] as const;

test('provides complete bilingual guidance for every EF Core Center action', () => {
  assert.deepEqual(Object.keys(EF_ACTION_HELP).sort(), [...actionIds].sort());

  for (const actionId of actionIds) {
    const help = actionHelpFor(actionId);
    assert.ok(help, `${actionId} must have usage guidance`);
    assert.ok(help.purpose.en.length > 20, `${actionId} needs an English purpose`);
    assert.ok(help.purpose.vi.length > 20, `${actionId} needs a Vietnamese purpose`);
    assert.ok(help.whenToUse.length > 0, `${actionId} needs a usage scenario`);
    assert.ok(help.prerequisites.length > 0, `${actionId} needs prerequisites`);
    assert.ok(help.result.en.length > 20, `${actionId} needs an expected result`);
    assert.ok(help.result.vi.length > 20, `${actionId} needs a Vietnamese result`);
    assert.ok(Object.keys(help.fields).length > 0, `${actionId} needs field guidance`);

    for (const [field, fieldHelp] of Object.entries(help.fields)) {
      assert.ok(fieldHelp.description.en, `${actionId}.${field} needs English help`);
      assert.ok(fieldHelp.description.vi, `${actionId}.${field} needs Vietnamese help`);
    }
  }
});

test('translates core Center chrome and keeps technical identifiers unchanged', () => {
  assert.equal(localizeEfText('How to use', 'vi'), 'Hướng dẫn sử dụng');
  assert.equal(localizeEfText('Generate SQL Script', 'vi'), 'Tạo SQL migration');
  assert.equal(localizeEfText('CustomAppSharedDbContext', 'vi'), 'CustomAppSharedDbContext');
  assert.equal(localizeEfText('dotnet ef migrations add', 'vi'), 'dotnet ef migrations add');
  assert.ok(hasVietnameseTranslation('Migrations project'));
  assert.ok(hasVietnameseTranslation('Generated command'));
});
