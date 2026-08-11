import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveBuildBeforeRunMode } from '../buildMode';

test('new build-before-run mode takes precedence when explicitly configured', () => {
  assert.equal(resolveBuildBeforeRunMode('smart', true, false, true), 'smart');
  assert.equal(resolveBuildBeforeRunMode('none', true, true, true), 'none');
});

test('legacy disabled setting migrates to none until the new setting is explicit', () => {
  assert.equal(resolveBuildBeforeRunMode('standard', false, false, true), 'none');
});

test('standard remains the safe default', () => {
  assert.equal(resolveBuildBeforeRunMode('standard', false, true, false), 'standard');
  assert.equal(resolveBuildBeforeRunMode(undefined, false, undefined, false), 'standard');
});
