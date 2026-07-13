import assert from 'assert/strict';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import test from 'node:test';
import { resolveMaxLineLength } from '../format/editorConfig';

test('resolves layered max_line_length sections for C# files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'navigator-editorconfig-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'src', 'Feature');
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(root, '.editorconfig'), 'root = true\n[*]\nmax_line_length = 100\n[*.{cs,vb}]\nmax_line_length = 110\n');
  await fs.writeFile(path.join(root, 'src', '.editorconfig'), '[*.cs]\nmax_line_length = 92\n');

  assert.equal(await resolveMaxLineLength(path.join(source, 'Example.cs')), 92);
  assert.equal(await resolveMaxLineLength(path.join(source, 'Example.vb')), 110);
  assert.equal(await resolveMaxLineLength(path.join(source, 'Example.txt')), 100);
});

test('supports relative path patterns and off overrides', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'navigator-editorconfig-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'generated'), { recursive: true });
  await fs.writeFile(path.join(root, '.editorconfig'), 'root=true\n[*.cs]\nmax_line_length=88\n[generated/*.cs]\nmax_line_length=off\n');

  assert.equal(await resolveMaxLineLength(path.join(root, 'Normal.cs')), 88);
  assert.equal(await resolveMaxLineLength(path.join(root, 'generated', 'Code.cs')), undefined);
});

test('supports recursive double-star patterns at zero or many directory levels', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'navigator-editorconfig-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'src', 'deep', 'feature'), { recursive: true });
  await fs.writeFile(path.join(root, '.editorconfig'), 'root=true\n[src/**/*.cs]\nmax_line_length=96\n');

  assert.equal(await resolveMaxLineLength(path.join(root, 'src', 'Root.cs')), 96);
  assert.equal(await resolveMaxLineLength(path.join(root, 'src', 'deep', 'feature', 'Nested.cs')), 96);
  assert.equal(await resolveMaxLineLength(path.join(root, 'test', 'Other.cs')), undefined);
});
