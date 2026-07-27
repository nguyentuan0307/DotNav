import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAdditionalArguments } from '../ef/efArguments';

test('parses quoted additional arguments without a shell', () => {
  assert.deepEqual(
    parseAdditionalArguments('--namespace "My Company.Migrations" --prefix-output=false').args,
    ['--namespace', 'My Company.Migrations', '--prefix-output=false']
  );
  assert.deepEqual(parseAdditionalArguments("--foo 'a b' empty\\ value").args, ['--foo', 'a b', 'empty value']);
});

test('rejects malformed or DotNav-managed arguments', () => {
  assert.match(parseAdditionalArguments('--namespace "broken').error ?? '', /unclosed/);
  assert.match(parseAdditionalArguments('--project Other.csproj').error ?? '', /managed by DotNav/);
  assert.match(parseAdditionalArguments('--connection secret').error ?? '', /managed by DotNav/);
});
