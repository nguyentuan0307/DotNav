import assert from 'node:assert/strict';
import test from 'node:test';
import { detectFormattingIntent } from '../format/formattingStyleDetector';
import { runFormatPasses } from '../format/passes';
import { FormatPassSettings, PassContext } from '../format/passes/types';

const settings: FormatPassSettings = {
  normalizeIndentWhitespace: true,
  enableLeadingComma: true,
  enableFluentChainWrap: true,
  enableBlankLineRules: true,
  leadingCommaWrapStyle: 'wrapIfLong'
};

const context: PassContext = {
  eol: '\n',
  indentUnit: '    ',
  tabSize: 4,
  fluentChainMinSegments: 2,
  wrapColumn: 80
};

test('formats a large C# document without quadratic list scanning', { timeout: 5_000 }, () => {
  const unit = [
    'public void Execute(string firstArgument, string secondArgument, CancellationToken cancellationToken) {',
    '',
    '    repository.Query()',
    '        .Where(x => x.Enabled)',
    '        .Select(x => x.Id);',
    '}'
  ].join('\n') + '\n';
  const input = unit.repeat(1_000);
  const started = performance.now();

  const formattingIntent = detectFormattingIntent(input, context.tabSize);
  const output = runFormatPasses(input, settings, { ...context, formattingIntent });
  const elapsed = performance.now() - started;

  assert.ok(output.length > 0);
  assert.ok(elapsed < 2_500, `expected 6,000 lines under 2,500 ms, received ${elapsed.toFixed(1)} ms`);
});
