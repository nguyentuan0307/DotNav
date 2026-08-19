import * as assert from 'assert';
import { test } from 'node:test';

function compareVersions(left: string, right: string): number {
  const parse = (value: string) => value.split('-', 1)[0].split('.').map(part => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

test('compareVersions handles semver correctly', () => {
  assert.ok(compareVersions('0.12.0', '0.11.0') > 0);
  assert.ok(compareVersions('0.11.0', '0.12.0') < 0);
  assert.equal(compareVersions('0.12.0', '0.12.0'), 0);
  assert.ok(compareVersions('1.0.0', '0.12.0') > 0);
});
