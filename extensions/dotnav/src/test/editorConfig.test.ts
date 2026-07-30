import assert from 'assert/strict';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import test from 'node:test';
import {
  CSharpFormattingStyle,
  resolveCSharpFormattingStyle,
  resolveMaxLineLength
} from '../format/editorConfig';

test('resolves layered max_line_length sections for C# files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'navigator-editorconfig-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'src', 'Feature');
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(root, '.editorconfig'), 'root = true\n[*]\nmax_line_length = 100\n[*.{cs,vb}]\nmax_line_length = 110\n');
  await fs.writeFile(path.join(root, 'src', '.editorconfig'), '[*.cs]\nmax_line_length = 92\n');

  assert.deepEqual(await resolveMaxLineLength(path.join(source, 'Example.cs')), { kind: 'value', value: 92 });
  assert.deepEqual(await resolveMaxLineLength(path.join(source, 'Example.vb')), { kind: 'value', value: 110 });
  assert.deepEqual(await resolveMaxLineLength(path.join(source, 'Example.txt')), { kind: 'value', value: 100 });
});

test('supports relative path patterns and off overrides', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'navigator-editorconfig-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'generated'), { recursive: true });
  await fs.writeFile(path.join(root, '.editorconfig'), 'root=true\n[*.cs]\nmax_line_length=88\n[generated/*.cs]\nmax_line_length=off\n');

  assert.deepEqual(await resolveMaxLineLength(path.join(root, 'Normal.cs')), { kind: 'value', value: 88 });
  assert.deepEqual(await resolveMaxLineLength(path.join(root, 'generated', 'Code.cs')), { kind: 'disabled' });
});

test('supports recursive double-star patterns at zero or many directory levels', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'navigator-editorconfig-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'src', 'deep', 'feature'), { recursive: true });
  await fs.writeFile(path.join(root, '.editorconfig'), 'root=true\n[src/**/*.cs]\nmax_line_length=96\n');

  assert.deepEqual(await resolveMaxLineLength(path.join(root, 'src', 'Root.cs')), { kind: 'value', value: 96 });
  assert.deepEqual(await resolveMaxLineLength(path.join(root, 'src', 'deep', 'feature', 'Nested.cs')), { kind: 'value', value: 96 });
  assert.deepEqual(await resolveMaxLineLength(path.join(root, 'test', 'Other.cs')), { kind: 'inherit' });
});

test('unset restores the DotNav fallback instead of disabling wrapping', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'navigator-editorconfig-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'generated'), { recursive: true });
  await fs.writeFile(
    path.join(root, '.editorconfig'),
    'root=true\n[*.cs]\nmax_line_length=88\n[generated/*.cs]\nmax_line_length=unset\n'
  );

  assert.deepEqual(
    await resolveMaxLineLength(path.join(root, 'generated', 'Code.cs')),
    { kind: 'inherit' }
  );
});

test('resolves DotNav-native C# formatting properties', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'navigator-editorconfig-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(root, '.editorconfig'),
    [
      'root=true',
      '[*.cs]',
      'dotnav_csharp_continuation_indent_multiplier=2',
      'dotnav_csharp_preserve_existing_layout=true',
      'dotnav_csharp_wrap_arguments=chop_always',
      'dotnav_csharp_wrap_before_comma=true'
    ].join('\n')
  );

  assert.deepEqual(
    await resolveCSharpFormattingStyle(path.join(root, 'Example.cs')),
    new CSharpFormattingStyle(2, true, 'chop_always', true)
  );
});

test('ignores invalid DotNav formatting values instead of guessing', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'navigator-editorconfig-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(root, '.editorconfig'),
    [
      'root=true',
      '[*.cs]',
      'dotnav_csharp_continuation_indent_multiplier=huge',
      'dotnav_csharp_preserve_existing_layout=sometimes',
      'dotnav_csharp_wrap_arguments=unknown'
    ].join('\n')
  );

  assert.deepEqual(
    await resolveCSharpFormattingStyle(path.join(root, 'Example.cs')),
    new CSharpFormattingStyle()
  );
});
