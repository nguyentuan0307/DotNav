import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBlankLines } from '../format/passes/blankLines';
import { formatFluentChains } from '../format/passes/fluentChain';
import { formatLeadingCommas } from '../format/passes/leadingComma';
import { PassContext } from '../format/passes/types';
import {
  FormatterCorpusCase,
  formatterCorpus
} from './fixtures/formatterCorpus';

const context: PassContext = {
  eol: '\n',
  indentUnit: '    ',
  tabSize: 4,
  fluentChainMinSegments: 2,
  wrapColumn: 60
};

for (const corpusCase of formatterCorpus) {
  test(`formatter corpus: ${corpusCase.name}`, () => {
    const output = format(corpusCase, corpusCase.input);

    assert.equal(output, corpusCase.expected);
    assert.equal(format(corpusCase, output), output, 'formatting must be idempotent');
  });
}

test('formatter fuzz: 2,000 generated valid list permutations preserve tokens and stabilize', () => {
  const random = seededRandom(0xD07A4);
  const items = [
    'first',
    'Get(one, two)',
    'new Pair<Three, Four>()',
    '"five,six"',
    '@"seven,eight"',
    '"""nine,ten"""',
    'item => item.Enabled',
    'condition ? left : right',
    '[one, two, three]',
    'new Model { Name = "a,b" }',
    '(one, two)',
    'typeof(Dictionary<One, Two>)',
    'first < second',
    'third > fourth',
    'value?.Property'
  ];

  for (let index = 0; index < 2_000; index++) {
    const selected = Array.from(
      { length: 2 + Math.floor(random() * 5) },
      () => items[Math.floor(random() * items.length)]
    );
    const indent = random() > 0.5 ? '    ' : '\t';
    const eol = random() > 0.5 ? '\n' : '\r\n';
    const local = { ...context, indentUnit: indent, eol };
    const input = `${indent}Call(${selected.join(', ')});`;
    const output = formatLeadingCommas(input, local, 'chopAlways');

    assert.equal(nonWhitespace(output), nonWhitespace(input), `token mismatch at generated case ${index}`);
    assert.equal(formatLeadingCommas(output, local, 'chopAlways'), output, `unstable generated case ${index}`);
  }
});

function format(corpusCase: FormatterCorpusCase, input: string): string {
  switch (corpusCase.formatter) {
    case 'leadingCommaChop':
      return formatLeadingCommas(input, context, 'chopAlways');
    case 'leadingCommaDefault':
      return formatLeadingCommas(input, context);
    case 'fluentChain':
      return formatFluentChains(input, context);
    case 'blankLines':
      return normalizeBlankLines(input);
  }
}

function nonWhitespace(value: string): string {
  return value.replace(/\s+/g, '');
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}
