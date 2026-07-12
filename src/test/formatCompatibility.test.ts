import assert from 'assert/strict';
import test from 'node:test';
import { formatLeadingCommas } from '../format/passes/leadingComma';
import { PassContext } from '../format/passes/types';

const ctx: PassContext = {
  eol: '\n',
  indentUnit: '    ',
  tabSize: 4,
  fluentChainMinSegments: 2,
  wrapColumn: 60
};

const wrappableCases: Record<string, string> = {
  'method invocation': 'Call(firstArgument, secondArgument, thirdArgument);',
  'object creation': 'var value = new Service(firstArgument, secondArgument, thirdArgument);',
  'method declaration': 'public void Execute(string firstArgument, string secondArgument, CancellationToken cancellationToken) { }',
  'constructor declaration': 'public Service(IDependency firstDependency, ILogger<Service> logger, IClock clock) { }',
  'attribute arguments': '[Example(typeof(Dictionary<One, Two>), Name = "one,two", Enabled = true)]',
  'nested invocations': 'Call(Build(one, two), Transform(three, four), finalValue);',
  'generic type arguments': 'Call(new Dictionary<One, Two>(), new Pair<Three, Four>(), finalValue);',
  'named arguments': 'Call(first: one, second: GetValue(two, three), cancellationToken: token);',
  'lambda argument': 'Call(source, item => item.Enabled && item.Name == "active", cancellationToken);',
  'tuple argument': 'Call((one, two), (three, four), finalValue);',
  'collection expression': 'Call([one, two, three], [four, five, six], finalValue);',
  'object initializer': 'Call(new Model { Name = "one,two", Enabled = true }, other, finalValue);',
  'empty and regular strings': 'Call("", "one,two", "three(four)", finalValue);',
  'verbatim string': 'Call(@"one,two(three)", secondValue, finalValue);',
  'interpolated verbatim string': 'Call(@$"one,{Get(two, three)}", secondValue, finalValue);',
  'raw string': 'Call("""one,two(three)""", secondValue, finalValue);',
  'char literal': "Call(',', '(', secondValue, finalValue);",
  'relational expressions': 'Call(first < second, third > fourth, finalValue);',
  'null operators': 'Call(first ?? fallback, second?.Value, third!.Value);',
  'fluent suffix': 'Call(firstArgument, secondArgument, thirdArgument).ConfigureAwait(false);',
  'record primary constructor': 'public sealed record Message(string Identifier, DateTime CreatedAt, IReadOnlyList<string> Values);',
  'constructor initializer': 'public Service(IDependency dependency, ILogger logger, IClock clock) : base(dependency, logger) { }',
  'delegate declaration': 'public delegate Task Handler(string identifier, object payload, CancellationToken cancellationToken);',
  'local function': 'Task ExecuteAsync(string identifier, object payload, CancellationToken cancellationToken) => Task.CompletedTask;',
  'array rank and generic': 'Call(new Dictionary<string, int[,]>(values), secondValue, finalValue);',
  'ternary argument': 'Call(condition ? first : second, otherCondition ? third : fourth, finalValue);',
  'static lambda': 'Call(source, static item => item.Enabled, cancellationToken);',
  'async lambda': 'Call(source, async item => await Transform(item), cancellationToken);',
  'type operators': 'Call(typeof(Dictionary<One, Two>), nameof(Model.Value), default(CancellationToken));',
  'tuple expression': 'var value = (firstElement, secondElement, thirdElement);'
};

for (const [name, input] of Object.entries(wrappableCases)) {
  test(`compatibility: wraps ${name} without changing tokens and is idempotent`, () => {
    const output = formatLeadingCommas(input, ctx, 'chopAlways');
    assert.notEqual(output, input);
    assert.equal(nonWhitespace(output), nonWhitespace(input));
    assert.equal(formatLeadingCommas(output, ctx, 'chopAlways'), output);
  });
}

const controlFlowCases = [
  'if (first && second && third) Execute();',
  'while (first || second || third) Execute();',
  'for (var index = 0; index < count; index++) Execute();',
  'foreach (var item in first.Concat(second)) Execute();',
  'switch (GetValue(first, second, third)) { }',
  'catch (Exception exception) { }',
  'using (var resource = Create(first, second)) Execute();',
  'lock (GetLock(first, second)) Execute();',
  'fixed (byte* pointer = buffer) Execute();',
  'return (first + second + third);'
];

for (const input of controlFlowCases) {
  test(`compatibility: leaves control-flow parentheses unchanged: ${input.split(' ')[0]}`, () => {
    assert.equal(formatLeadingCommas(input, { ...ctx, wrapColumn: 10 }, 'chopAlways'), input);
  });
}

const unsafeMultilineCases: Record<string, string> = {
  'preprocessor directives': [
    'Call(',
    '    first,',
    '#if FEATURE',
    '    second,',
    '#endif',
    '    third',
    ');'
  ].join('\n'),
  'line comment between arguments': [
    'Call(',
    '    first,',
    '    // belongs to second',
    '    second',
    ');'
  ].join('\n'),
  'block comment between arguments': [
    'Call(',
    '    first,',
    '    /* belongs to second */',
    '    second',
    ');'
  ].join('\n')
};

for (const [name, input] of Object.entries(unsafeMultilineCases)) {
  test(`compatibility: safely skips multiline list with ${name}`, () => {
    assert.equal(formatLeadingCommas(input, ctx), input);
  });
}

test('compatibility: multiline generic commas are not mistaken for argument separators', () => {
  const input = [
    'Call(',
    '        new Dictionary<One, Two>(),',
    '      finalValue',
    ');'
  ].join('\n');
  const output = formatLeadingCommas(input, ctx);
  assert.equal(output, [
    'Call(',
    '    new Dictionary<One, Two>()',
    '    , finalValue',
    ');'
  ].join('\n'));
  assert.equal(formatLeadingCommas(output, ctx), output);
});

test('compatibility: malformed and unbalanced input is left intact', () => {
  const input = 'Call(first, second, third;';
  assert.equal(formatLeadingCommas(input, ctx, 'chopAlways'), input);
});

test('compatibility: preserves CRLF while wrapping', () => {
  const local = { ...ctx, eol: '\r\n' };
  const input = 'Call(firstArgument, secondArgument, thirdArgument);';
  const output = formatLeadingCommas(input, local, 'chopAlways');
  assert.ok(output.includes('\r\n'));
  assert.equal(output.replace(/\r\n/g, '').includes('\n'), false);
  assert.equal(formatLeadingCommas(output, local, 'chopAlways'), output);
});

test('compatibility: preserves suffix comments when wrapping a standalone call', () => {
  const input = 'Call(firstArgument, secondArgument, thirdArgument); // important review note';
  const output = formatLeadingCommas(input, ctx, 'chopAlways');
  assert.ok(output.endsWith('); // important review note'));
  assert.equal(nonWhitespace(output), nonWhitespace(input));
});

test('compatibility: nested multiline lists remain stable across repeated formatting', () => {
  const input = [
    'Outer(',
    '        Inner(',
    '            first,',
    '          second',
    '        ),',
    '      finalValue',
    ');'
  ].join('\n');
  const once = formatLeadingCommas(input, ctx);
  const twice = formatLeadingCommas(once, ctx);
  assert.equal(twice, once);
  assert.equal(nonWhitespace(once), nonWhitespace(input));
});

test('compatibility: wrap styles have distinct and stable behavior', () => {
  const input = 'Call(first, second, third);';
  assert.equal(formatLeadingCommas(input, { ...ctx, wrapColumn: 100 }, 'keep'), input);
  assert.equal(formatLeadingCommas(input, { ...ctx, wrapColumn: 100 }, 'wrapIfLong'), input);
  assert.notEqual(formatLeadingCommas(input, { ...ctx, wrapColumn: 100 }, 'chopAlways'), input);
});

const generatedItemSets = [
  ['first', 'second', 'third'],
  ['Get(one, two)', 'new Pair<Three, Four>()', 'finalValue'],
  ['"one,two"', '@"three(four)"', "','"],
  ['item => item.Enabled', 'condition ? first : second', 'token'],
  ['[one, two]', 'new Model { Name = "a,b" }', '(three, four)'],
  ['typeof(Dictionary<One, Two>)', 'nameof(Model.Value)', 'default(CancellationToken)']
];

for (const [setIndex, items] of generatedItemSets.entries()) {
  for (const indentUnit of ['  ', '\t']) {
    for (const eol of ['\n', '\r\n']) {
      test(`compatibility matrix: item set ${setIndex + 1}, ${indentUnit === '\t' ? 'tabs' : 'spaces'}, ${eol === '\n' ? 'LF' : 'CRLF'}`, () => {
        const local = { ...ctx, indentUnit, eol, wrapColumn: 32 };
        const input = `${indentUnit}Call(${items.join(', ')});`;
        const output = formatLeadingCommas(input, local, 'chopAlways');
        assert.equal(nonWhitespace(output), nonWhitespace(input));
        assert.equal(formatLeadingCommas(output, local, 'chopAlways'), output);
        if (output.includes('\n')) assert.equal(eol === '\r\n', output.includes('\r\n'));
      });
    }
  }
}

function nonWhitespace(text: string): string {
  return text.replace(/\s+/g, '');
}
