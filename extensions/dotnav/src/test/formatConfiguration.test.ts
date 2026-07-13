import assert from 'assert/strict';
import { readFileSync } from 'fs';
import * as path from 'path';
import test from 'node:test';

test('format selection is strict by default and member expansion is opt-in', () => {
  const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  const setting = manifest.contributes.configuration.properties['dotnav.format.expandToEnclosingMember'];

  assert.equal(setting.default, false);
  assert.match(setting.description, /only changes the selected lines/i);
});
