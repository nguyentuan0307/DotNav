import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilitiesForVersions, parseMajor } from '../ef/efCapabilities';

test('parses stable and preview EF versions', () => {
  assert.equal(parseMajor('7.0.20'), 7);
  assert.equal(parseMajor('Entity Framework Core .NET Command-line Tools 11.0.0-preview.4'), 11);
  assert.equal(parseMajor(undefined), undefined);
});

test('gates features by the lower project/tool major', () => {
  const ef7 = capabilitiesForVersions('7.0.20', '11.0.0');
  assert.equal(ef7.major, 7);
  assert.equal(ef7.hasPendingModelChanges, false);
  assert.equal(ef7.removeOffline, false);
  assert.equal(ef7.dropConnection, false);
  assert.equal(ef7.migrationsBundle, true);
  assert.equal(ef7.optimizeNativeAot, false);

  const ef11 = capabilitiesForVersions('11.0.0', '11.0.1');
  assert.equal(ef11.hasPendingModelChanges, true);
  assert.equal(ef11.removeOffline, true);
  assert.equal(ef11.updateAdd, true);
  assert.equal(ef11.dropConnection, true);
  assert.equal(ef11.optimizeNativeAot, true);
});
