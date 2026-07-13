import assert from 'assert/strict';
import test from 'node:test';
import { buildCodeMask, classifySpans } from '../format/csharpLexer';

test('classifies strings and comments outside code spans', () => {
  const text = [
    'var a = "keep   spaces"; // comment',
    'var b = @"keep ""quoted"" spaces";',
    'var c = \'\\\'\';',
    '/* block */ var d = 1;'
  ].join('\n');

  const spans = classifySpans(text);

  assert.ok(spans.some(span => span.kind === 'string'));
  assert.ok(spans.some(span => span.kind === 'verbatimString'));
  assert.ok(spans.some(span => span.kind === 'charLiteral'));
  assert.ok(spans.some(span => span.kind === 'lineComment'));
  assert.ok(spans.some(span => span.kind === 'blockComment'));
});

test('marks interpolation holes as rewritable code', () => {
  const text = 'var value = $"a={ 1+2 }";';
  const mask = buildCodeMask(text);
  const holeIndex = text.indexOf('1+2');
  const stringIndex = text.indexOf('a=');

  assert.equal(mask[holeIndex], true);
  assert.equal(mask[stringIndex], false);
});

test('keeps raw strings as non-code', () => {
  const text = 'var raw = """\n  keep { these }\n""";';
  const spans = classifySpans(text);
  const raw = spans.find(span => span.kind === 'rawString');

  assert.ok(raw);
  assert.equal(text.slice(raw.start, raw.end), '"""\n  keep { these }\n"""');
});

test('ends empty and adjacent regular strings at the correct quote', () => {
  const text = 'Call("", first, "second", third);';
  const mask = buildCodeMask(text);

  assert.equal(mask[text.indexOf('first')], true);
  assert.equal(mask[text.indexOf('second')], false);
  assert.equal(mask[text.indexOf('third')], true);
});

test('recognizes both orders of interpolated verbatim string prefixes', () => {
  for (const text of ['$@"value,{one}"', '@$"value,{one}"']) {
    const spans = classifySpans(text);
    assert.equal(spans.some(span => span.kind === 'verbatimString'), true);
    assert.equal(buildCodeMask(text)[text.indexOf('value')], false);
  }
});

test('does not expose punctuation inside char, verbatim, raw, and interpolated literals as code', () => {
  const literals = [
    "','",
    '@"one,two(three)"',
    '"""one,two(three)"""',
    '$"one,two({Call(three, four)})"'
  ];
  for (const literal of literals) {
    const text = `Use(${literal}, finalValue);`;
    const mask = buildCodeMask(text);
    const literalComma = text.indexOf(',');
    assert.equal(mask[literalComma], false);
  }
});
