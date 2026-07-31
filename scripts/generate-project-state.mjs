import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const documentPath = join(repositoryRoot, 'docs', 'CURRENT_STATE.md');
const startMarker = '<!-- project-state:start -->';
const endMarker = '<!-- project-state:end -->';

function packageVersion(relativePath) {
  return JSON.parse(readFileSync(join(repositoryRoot, relativePath), 'utf8')).version;
}

function testFileCount(relativePath) {
  return readdirSync(join(repositoryRoot, relativePath), { recursive: true })
    .filter(name => name.endsWith('.test.ts'))
    .length;
}

function sourceCheckpoint() {
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  }).trim();
}

export function generatedProjectState() {
  return [
    startMarker,
    `- Source checkpoint: \`${sourceCheckpoint()}\``,
    `- DotNav version: \`${packageVersion('extensions/dotnav/package.json')}\``,
    `- GitNav version: \`${packageVersion('extensions/gitnav/package.json')}\``,
    `- Test files: DotNav \`${testFileCount('extensions/dotnav/src/test')}\`, GitNav \`${testFileCount('extensions/gitnav/src/test')}\``,
    '- Verification command: `npm test`',
    endMarker
  ].join('\n');
}

export function updateProjectState(current) {
  const start = current.indexOf(startMarker);
  const end = current.indexOf(endMarker);
  if (start < 0 || end < start) throw new Error('CURRENT_STATE.md is missing generated block markers.');
  return current.slice(0, start)
    + generatedProjectState()
    + current.slice(end + endMarker.length);
}

if (process.argv.includes('--print')) {
  process.stdout.write(`${generatedProjectState()}\n`);
} else {
  const current = readFileSync(documentPath, 'utf8');
  const updated = updateProjectState(current);
  if (process.argv.includes('--check')) {
    if (updated !== current) {
      console.error('docs/CURRENT_STATE.md is stale. Run: node scripts/generate-project-state.mjs');
      process.exitCode = 1;
    }
  } else {
    writeFileSync(documentPath, updated);
  }
}
