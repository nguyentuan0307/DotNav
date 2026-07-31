import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';

test('keeps generated project state aligned with package versions', () => {
  const repositoryRoot = path.join(__dirname, '..', '..', '..', '..');
  const document = execFileSync(
    process.execPath,
    [path.join(repositoryRoot, 'scripts', 'generate-project-state.mjs'), '--print'],
    { cwd: repositoryRoot, encoding: 'utf8' }
  );
  const dotnav = JSON.parse(readFileSync(
    path.join(repositoryRoot, 'extensions', 'dotnav', 'package.json'),
    'utf8'
  ));
  const gitnav = JSON.parse(readFileSync(
    path.join(repositoryRoot, 'extensions', 'gitnav', 'package.json'),
    'utf8'
  ));

  assert.match(document, /<!-- project-state:start -->[\s\S]*<!-- project-state:end -->/);
  assert.ok(document.includes(`DotNav version: \`${dotnav.version}\``));
  assert.ok(document.includes(`GitNav version: \`${gitnav.version}\``));
});
