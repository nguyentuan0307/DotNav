import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchingProtectedBranchPattern } from '../git/gitBranchProtection';

test('matches exact and wildcard protected branch patterns', () => {
  assert.equal(matchingProtectedBranchPattern('main', ['main', 'release/*']), 'main');
  assert.equal(matchingProtectedBranchPattern('release/2026.07', ['main', 'release/*']), 'release/*');
  assert.equal(matchingProtectedBranchPattern('feature/main', ['main', 'release/*']), undefined);
});

test('treats regex characters in protected patterns literally', () => {
  assert.equal(matchingProtectedBranchPattern('release/v1.2', ['release/v1.2']), 'release/v1.2');
  assert.equal(matchingProtectedBranchPattern('release/v1x2', ['release/v1.2']), undefined);
});
