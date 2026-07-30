import assert from 'assert/strict';
import test from 'node:test';
import { detectFormattingIntent } from '../format/formattingStyleDetector';
import { formatFluentChains } from '../format/passes/fluentChain';
import { formatLeadingCommas } from '../format/passes/leadingComma';
import { PassContext } from '../format/passes/types';

class IndentStyleCase {
  constructor(
    readonly name: string,
    readonly indentUnit: string,
    readonly tabSize: number
  ) {}
}

const styles = [
  new IndentStyleCase('tabs', '\t', 4),
  new IndentStyleCase('four spaces', '    ', 4),
  new IndentStyleCase('two spaces', '  ', 2)
];

for (const style of styles) {
  for (const multiplier of [1, 2, 3]) {
    test(`smart intent: preserves ${multiplier}-level fluent indent with ${style.name}`, () => {
      const base = style.indentUnit.repeat(2);
      const intendedIndent = base + style.indentUnit.repeat(multiplier);
      const normalizedIndent = base + style.indentUnit;
      const original = [
        `${base}var values = source`,
        `${intendedIndent}.Where(item => item.Enabled)`,
        `${intendedIndent}.Select(item => item.Id)`,
        `${intendedIndent}.ToList();`
      ].join('\n');
      const normalized = [
        `${base}var values = source`,
        `${normalizedIndent}.Where(item => item.Enabled)`,
        `${normalizedIndent}.Select(item => item.Id)`,
        `${normalizedIndent}.ToList();`
      ].join('\n');

      assert.equal(formatFluentChains(normalized, context(style, original)), original);
    });

    test(`smart intent: preserves ${multiplier}-level argument indent with ${style.name}`, () => {
      const base = style.indentUnit.repeat(2);
      const intendedIndent = base + style.indentUnit.repeat(multiplier);
      const normalizedIndent = base + style.indentUnit;
      const original = [
        `${base}Call(first`,
        `${intendedIndent}, second`,
        `${intendedIndent}, third`,
        `${base});`
      ].join('\n');
      const normalized = [
        `${base}Call(first`,
        `${normalizedIndent}, second`,
        `${normalizedIndent}, third`,
        `${base});`
      ].join('\n');

      assert.equal(formatLeadingCommas(normalized, context(style, original)), original);
    });
  }
}

test('smart intent: preserves deliberate column alignment that is not a whole indent level', () => {
  const original = [
    '    var values = source',
    '          .Where(item => item.Enabled)',
    '          .Select(item => item.Id)',
    '          .ToList();'
  ].join('\n');
  const normalized = [
    '    var values = source',
    '        .Where(item => item.Enabled)',
    '        .Select(item => item.Id)',
    '        .ToList();'
  ].join('\n');
  const style = new IndentStyleCase('four spaces', '    ', 4);

  assert.equal(formatFluentChains(normalized, context(style, original)), original);
});

function context(style: IndentStyleCase, original: string): PassContext {
  return {
    eol: '\n',
    indentUnit: style.indentUnit,
    tabSize: style.tabSize,
    fluentChainMinSegments: 2,
    wrapColumn: 120,
    formattingIntent: detectFormattingIntent(original, style.tabSize)
  };
}
