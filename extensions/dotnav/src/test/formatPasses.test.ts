import assert from 'assert/strict';
import test from 'node:test';
import { detectFormattingIntent } from '../format/formattingStyleDetector';
import { normalizeBlankLines } from '../format/passes/blankLines';
import { formatFluentChains } from '../format/passes/fluentChain';
import { runFormatPasses } from '../format/passes';
import { formatLeadingCommas } from '../format/passes/leadingComma';
import { normalizeIndentWhitespace } from '../format/passes/normalizeIndentWhitespace';
import { PassContext } from '../format/passes/types';

const ctx: PassContext = {
  eol: '\n',
  indentUnit: '\t',
  tabSize: 4,
  fluentChainMinSegments: 3,
  wrapColumn: 120
};

test('normalizes mixed leading indentation only on code lines', () => {
  const input = [
    '\t  var x = 1;',
    '\t  // keep comment indent',
    '\t  var s = @"',
    '\t  keep string indent";'
  ].join('\n');

  const output = normalizeIndentWhitespace(input, ctx);

  assert.equal(output.split('\n')[0], '\t\tvar x = 1;');
  assert.equal(output.split('\n')[1], '\t  // keep comment indent');
  assert.equal(normalizeIndentWhitespace(output, ctx), output);
});

test('uses tab stops when spaces appear before a tab', () => {
  const input = '  \tvar x = 1;';

  assert.equal(normalizeIndentWhitespace(input, ctx), '\tvar x = 1;');
});

test('normalizes existing leading-comma continuation indentation', () => {
  const input = [
    '\tpublic CompanyRoleService(',
    '\t\tIUnitOfWorkBase unitOfWork',
    '\t\t\t\t, IServiceProvider serviceProvider',
    '\t\t\t\t, ICompanyRoleRepository repository',
    '\t\t)',
    '\t{',
    '\t}'
  ].join('\n');

  const output = formatLeadingCommas(input, ctx);

  assert.equal(output, [
    '\tpublic CompanyRoleService(',
    '\t\tIUnitOfWorkBase unitOfWork',
    '\t\t, IServiceProvider serviceProvider',
    '\t\t, ICompanyRoleRepository repository',
    '\t\t)',
    '\t{',
    '\t}'
  ].join('\n'));
  assert.equal(formatLeadingCommas(output, ctx), output);
});

test('wraps long single-line argument lists with leading commas', () => {
  const input = '\tCall(firstArgument, secondArgument, thirdArgument, fourthArgument, fifthArgument, sixthArgument, seventhArgument, eighthArgument, ninthArgument);';
  const output = formatLeadingCommas(input, ctx);

  assert.ok(output.includes('\n\t\t, eighthArgument, ninthArgument);'));
  assert.ok(output.split('\n')[0].length <= ctx.wrapColumn);
  assert.equal(formatLeadingCommas(output, ctx), output);
});

test('normalizes indentation with spaces when the editor uses insertSpaces', () => {
  const spaces = { ...ctx, indentUnit: '    ' };
  const input = '      var first = 1;\n\t  var second = 2;';
  const output = normalizeIndentWhitespace(input, spaces);

  assert.equal(output, '        var first = 1;\n        var second = 2;');
  assert.equal(output.includes('\t'), false);
  assert.equal(normalizeIndentWhitespace(output, spaces), output);
});

test('keeps nested calls, generic commas, strings, and suffixes intact', () => {
  const local = { ...ctx, wrapColumn: 55 };
  const input = '\tvar value = Call(A(one, two), B<One, Two>(three, four), "five,six", seventh).ToString();';
  const output = formatLeadingCommas(input, local);

  assert.equal(stripWhitespace(output), stripWhitespace(input));
  assert.ok(output.endsWith(').ToString();'));
  assert.ok((output.match(/^\s*,/gm)?.length ?? 0) >= 1);
  assert.ok(output.includes('A(one, two)'));
  assert.ok(output.includes('B<One, Two>(three, four)'));
  assert.equal(formatLeadingCommas(output, local), output);
});

test('does not treat control-flow conditions as argument lists', () => {
  const local = { ...ctx, wrapColumn: 30 };
  const inputs = [
    '\tif (firstCondition && secondCondition && thirdCondition) Go();',
    '\twhile (firstCondition || secondCondition || thirdCondition) Go();',
    '\tfor (var index = 0; index < veryLargeNumber; index++) Go();',
    '\treturn (firstValue + secondValue + thirdValue);'
  ];
  for (const input of inputs) assert.equal(formatLeadingCommas(input, local), input);
});

test('keep only suppresses new wrapping and still normalizes existing lists', () => {
  const long = '\tCall(firstArgument, secondArgument, thirdArgument);';
  assert.equal(formatLeadingCommas(long, { ...ctx, wrapColumn: 20 }, 'keep'), long);
  assert.equal(formatLeadingCommas('\tCall(\n\t\tfirst\n\t\t\t, second\n\t)', ctx, 'keep'), '\tCall(\n\t\tfirst\n\t\t, second\n\t)');
});

test('uses the first leading-comma continuation as anchor when the first item is inline', () => {
  const input = [
    '\t\tawait mediator.Publish(new DomainEvent(record.Id)',
    '\t\t\t\t\t, new List<int> { record.Id }',
    '\t\t\t, tenantId',
    '\t\t, null',
    '\t\t\t\t, cancellationToken);'
  ].join('\n');
  const output = formatLeadingCommas(input, ctx);

  assert.equal(output, [
    '\t\tawait mediator.Publish(new DomainEvent(record.Id)',
    '\t\t\t\t\t, new List<int> { record.Id }',
    '\t\t\t\t\t, tenantId',
    '\t\t\t\t\t, null',
    '\t\t\t\t\t, cancellationToken);'
  ].join('\n'));
  assert.equal(formatLeadingCommas(output, ctx), output);
});

test('aligns a strict-selection fragment that contains only leading-comma lines', () => {
  const input = [
    '\t\t\t\t, firstSelectedArgument',
    '\t\t, secondSelectedArgument',
    '\t\t\t, thirdSelectedArgument'
  ].join('\n');

  assert.equal(formatLeadingCommas(input, ctx), [
    '\t\t\t\t, firstSelectedArgument',
    '\t\t\t\t, secondSelectedArgument',
    '\t\t\t\t, thirdSelectedArgument'
  ].join('\n'));
});

test('normalizes fluent chain indentation without rewriting its object initializer body', () => {
  const input = [
    '\tvar models = source',
    '\t\t\t.Where(_ => _.Enabled)',
    '\t\t\t\t.Select(_ => new RecordSortModel()',
    '\t{',
    '\t\tSortFieldType = _.Type',
    '\t})',
    '\t.ToList();'
  ].join('\n');

  const output = formatFluentChains(input, ctx);

  assert.equal(output, [
    '\tvar models = source',
    '\t\t.Where(_ => _.Enabled)',
    '\t\t.Select(_ => new RecordSortModel()',
    '\t{',
    '\t\tSortFieldType = _.Type',
    '\t})',
    '\t\t.ToList();'
  ].join('\n'));
  assert.equal(formatFluentChains(output, ctx), output);
});

test('keeps outer chain alignment across a multiline predicate', () => {
  const input = [
    '\tvar ids = await repository',
    '\t\t.GetQuery(item => item.Enabled',
    '\t\t\t&& item.Status == Status.Active',
    '\t\t\t&& item.ReferenceId.HasValue)',
    '\t\t\t.OrderBy(item => item.Id)',
    '\t\t.Select(item => item.Id)',
    '\t\t\t.ToListAsync(cancellationToken);'
  ].join('\n');

  assert.equal(formatFluentChains(input, { ...ctx, fluentChainMinSegments: 2 }), [
    '\tvar ids = await repository',
    '\t\t.GetQuery(item => item.Enabled',
    '\t\t\t&& item.Status == Status.Active',
    '\t\t\t&& item.ReferenceId.HasValue)',
    '\t\t.OrderBy(item => item.Id)',
    '\t\t.Select(item => item.Id)',
    '\t\t.ToListAsync(cancellationToken);'
  ].join('\n'));
});

test('keeps initializer scope indented while aligning surrounding fluent calls', () => {
  const input = [
    '\tvar models = source',
    '\t\t\t.Select(sort => new ViewSortMigrationModel',
    '\t\t\t{',
    '\t\t\t\tProjectViewId = sort.ViewId!.Value,',
    '\t\t\t\tFieldId = sort.FieldId,',
    '\t\t\t\tSortType = sort.Type,',
    '\t\t\t})',
    '\t\t\t.ToListAsync(cancellationToken);'
  ].join('\n');

  assert.equal(formatFluentChains(input, { ...ctx, fluentChainMinSegments: 2 }), [
    '\tvar models = source',
    '\t\t.Select(sort => new ViewSortMigrationModel',
    '\t\t\t{',
    '\t\t\t\tProjectViewId = sort.ViewId!.Value,',
    '\t\t\t\tFieldId = sort.FieldId,',
    '\t\t\t\tSortType = sort.Type,',
    '\t\t\t})',
    '\t\t.ToListAsync(cancellationToken);'
  ].join('\n'));
});

test('leaves short fluent chains below threshold unchanged', () => {
  const input = [
    '\tvar models = source',
    '\t\t\t.Where(_ => _.Enabled)',
    '\t\t.ToList();'
  ].join('\n');

  assert.equal(formatFluentChains(input, ctx), input);
});

test('aligns two sibling MongoDB builder calls to the same column by default', () => {
  const input = [
    '\tawait repository.Collection.UpdateManyAsync(',
    '\t\t_ => prospectIds.Contains(_.Id!),',
    '\t\tBuilders<Prospect>.Update',
    '\t\t\t\t.Set(_ => _.UpdatedAt, DateTime.UtcNow)',
    '\t\t\t.Set(_ => _.LastMessageSentAt, DateTime.UtcNow)',
    '\t);'
  ].join('\n');

  const output = formatFluentChains(input, { ...ctx, fluentChainMinSegments: 2 });

  assert.equal(output, [
    '\tawait repository.Collection.UpdateManyAsync(',
    '\t\t_ => prospectIds.Contains(_.Id!),',
    '\t\tBuilders<Prospect>.Update',
    '\t\t\t.Set(_ => _.UpdatedAt, DateTime.UtcNow)',
    '\t\t\t.Set(_ => _.LastMessageSentAt, DateTime.UtcNow)',
    '\t);'
  ].join('\n'));
  assert.equal(formatFluentChains(output, { ...ctx, fluentChainMinSegments: 2 }), output);
});

test('aligns fluent calls containing strings and trailing comments', () => {
  const local = { ...ctx, fluentChainMinSegments: 2 };
  const input = [
    '\tvar query = source',
    '\t\t\t.Where(x => x.Name == "active") // preserve this comment',
    '\t\t.Select(x => x.Id);'
  ].join('\n');

  assert.equal(formatFluentChains(input, local), [
    '\tvar query = source',
    '\t\t.Where(x => x.Name == "active") // preserve this comment',
    '\t\t.Select(x => x.Id);'
  ].join('\n'));
});

test('aligns one fluent chain across an attached comment and blank line', () => {
  const local = { ...ctx, fluentChainMinSegments: 2 };
  const input = [
    '\tvar query = source',
    '\t\t\t.Where(x => x.Enabled)',
    '\t\t\t// projection stays with the chain',
    '',
    '\t\t.Select(x => x.Id);'
  ].join('\n');

  assert.equal(formatFluentChains(input, local), [
    '\tvar query = source',
    '\t\t.Where(x => x.Enabled)',
    '\t\t// projection stays with the chain',
    '',
    '\t\t.Select(x => x.Id);'
  ].join('\n'));
});

test('aligns null-conditional fluent continuations', () => {
  const local = { ...ctx, fluentChainMinSegments: 2 };
  const input = [
    '\tvar result = source',
    '\t\t\t?.Where(x => x.Enabled)',
    '\t?.ToList();'
  ].join('\n');

  assert.equal(formatFluentChains(input, local), [
    '\tvar result = source',
    '\t\t?.Where(x => x.Enabled)',
    '\t\t?.ToList();'
  ].join('\n'));
});

test('uses the first fluent line as anchor when a strict selection omits the parent expression', () => {
  const local = { ...ctx, fluentChainMinSegments: 2 };
  const input = [
    '\t\t\t\t.Set(_ => _.UpdatedAt, DateTime.UtcNow)',
    '\t\t.Set(_ => _.LastMessageSentAt, DateTime.UtcNow)',
    '\t\t\t.Set(_ => _.Enabled, true)'
  ].join('\n');

  assert.equal(formatFluentChains(input, local), [
    '\t\t\t\t.Set(_ => _.UpdatedAt, DateTime.UtcNow)',
    '\t\t\t\t.Set(_ => _.LastMessageSentAt, DateTime.UtcNow)',
    '\t\t\t\t.Set(_ => _.Enabled, true)'
  ].join('\n'));
});

test('preserves a consistent two-level fluent indent detected before formatting', () => {
  const original = [
    '\t\tvar recordFieldIds = recordFormulaExpression.FieldDeps',
    '\t\t\t\t.Where(item => item.FieldId.HasValue)',
    '\t\t\t\t.Select(item => item.FieldId!.Value)',
    '\t\t\t\t.ToHashSet();'
  ].join('\n');
  const roslynNormalized = [
    '\t\tvar recordFieldIds = recordFormulaExpression.FieldDeps',
    '\t\t\t.Where(item => item.FieldId.HasValue)',
    '\t\t\t.Select(item => item.FieldId!.Value)',
    '\t\t\t.ToHashSet();'
  ].join('\n');
  const local = {
    ...ctx,
    fluentChainMinSegments: 2,
    formattingIntent: detectFormattingIntent(original, 4)
  };

  assert.equal(formatFluentChains(roslynNormalized, local), original);
  assert.equal(formatFluentChains(original, local), original);
});

test('explicit continuation multiplier overrides detected local intent', () => {
  const original = [
    '\t\tvar values = source',
    '\t\t\t\t.Where(item => item.Enabled)',
    '\t\t\t\t.Select(item => item.Id)',
    '\t\t\t\t.ToList();'
  ].join('\n');
  const local = {
    ...ctx,
    fluentChainMinSegments: 2,
    continuationIndentMultiplier: 1,
    formattingIntent: detectFormattingIntent(original, 4)
  };

  assert.equal(formatFluentChains(original, local), [
    '\t\tvar values = source',
    '\t\t\t.Where(item => item.Enabled)',
    '\t\t\t.Select(item => item.Id)',
    '\t\t\t.ToList();'
  ].join('\n'));
});

test('preserves a detected two-level leading-comma list after prior normalization', () => {
  const original = [
    '\t\tCall(first',
    '\t\t\t\t, second',
    '\t\t\t\t, third',
    '\t\t);'
  ].join('\n');
  const normalized = [
    '\t\tCall(first',
    '\t\t\t, second',
    '\t\t\t, third',
    '\t\t);'
  ].join('\n');
  const local = {
    ...ctx,
    formattingIntent: detectFormattingIntent(original, 4)
  };

  assert.equal(formatLeadingCommas(normalized, local), original);
  assert.equal(formatLeadingCommas(original, local), original);
});

test('preserves mixed outer and nested intent from the reported formula code', () => {
  const original = [
    '\tvar data = await GetFormulaDataValueAsync(formulaField.ParentId.HasValue',
    '\t\t\t, recordIds',
    '\t\t\t, parentRecordId',
    '\t\t\t, fields',
    '\t\t\t, cancellationToken);',
    '',
    '\tvar recordFormulas = recordFormulaExpressions',
    '\t\t.Select((recordFormulaExpression, index) =>',
    '\t\t{',
    '\t\t\tvar recordFieldIds = recordFormulaExpression.FieldDeps',
    '\t\t\t\t\t.Where(item => item.FieldId.HasValue)',
    '\t\t\t\t\t.Select(item => item.FieldId!.Value)',
    '\t\t\t\t\t.ToHashSet();',
    '',
    '\t\t\tvar recordFields = fields',
    '\t\t\t\t\t.Where(item => recordFieldIds.Contains(item.Id))',
    '\t\t\t\t\t.Select(item => item.ReferenceId)',
    '\t\t\t\t\t.ToList();',
    '\t\t});'
  ].join('\n');
  const roslynNormalized = [
    '\tvar data = await GetFormulaDataValueAsync(formulaField.ParentId.HasValue',
    '\t\t, recordIds',
    '\t\t, parentRecordId',
    '\t\t, fields',
    '\t\t, cancellationToken);',
    '',
    '\tvar recordFormulas = recordFormulaExpressions',
    '\t\t.Select((recordFormulaExpression, index) =>',
    '\t\t{',
    '\t\t\tvar recordFieldIds = recordFormulaExpression.FieldDeps',
    '\t\t\t\t.Where(item => item.FieldId.HasValue)',
    '\t\t\t\t.Select(item => item.FieldId!.Value)',
    '\t\t\t\t.ToHashSet();',
    '',
    '\t\t\tvar recordFields = fields',
    '\t\t\t\t.Where(item => recordFieldIds.Contains(item.Id))',
    '\t\t\t\t.Select(item => item.ReferenceId)',
    '\t\t\t\t.ToList();',
    '\t\t});'
  ].join('\n');
  const output = runFormatPasses(roslynNormalized, {
    normalizeIndentWhitespace: true,
    enableLeadingComma: true,
    enableFluentChainWrap: true,
    enableBlankLineRules: false,
    leadingCommaWrapStyle: 'keep'
  }, {
    ...ctx,
    fluentChainMinSegments: 2,
    formattingIntent: detectFormattingIntent(original, 4)
  });

  assert.equal(output, original);
  assert.equal(runFormatPasses(output, {
    normalizeIndentWhitespace: true,
    enableLeadingComma: true,
    enableFluentChainWrap: true,
    enableBlankLineRules: false,
    leadingCommaWrapStyle: 'keep'
  }, {
    ...ctx,
    fluentChainMinSegments: 2,
    formattingIntent: detectFormattingIntent(original, 4)
  }), original);
});

test('normalizes a leading-comma string argument without touching its contents', () => {
  const input = [
    '\tCall(',
    '\t\tfirst',
    '\t\t\t\t, "second,value"',
    '\t);'
  ].join('\n');

  assert.equal(formatLeadingCommas(input, ctx), [
    '\tCall(',
    '\t\tfirst',
    '\t\t, "second,value"',
    '\t);'
  ].join('\n'));
});

test('normalizes lists containing leading comments without changing comment order', () => {
  const input = [
    '\tCall(',
    '\t\tfirst,',
    '\t\t// belongs to second',
    '\t\tsecond,',
    '\t\t/* belongs to third */',
    '\t\tthird',
    '\t);'
  ].join('\n');
  const output = formatLeadingCommas(input, ctx);

  assert.equal(output, [
    '\tCall(',
    '\t\tfirst',
    '\t\t, // belongs to second',
    '\t\tsecond',
    '\t\t, /* belongs to third */',
    '\t\tthird',
    '\t);'
  ].join('\n'));
  assert.equal(formatLeadingCommas(output, ctx), output);
});

test('normalizes a simple conditional argument list branch safely', () => {
  const input = [
    'Call(',
    '    first,',
    '#if FEATURE',
    '    second,',
    '#else',
    '    fallback,',
    '#endif',
    '    third',
    ');'
  ].join('\n');
  const output = formatLeadingCommas(input, { ...ctx, indentUnit: '    ' });

  assert.equal(output, [
    'Call(',
    '    first',
    '#if FEATURE',
    '    , second',
    '#else',
    '    , fallback',
    '#endif',
    '    , third',
    ');'
  ].join('\n'));
  assert.equal(formatLeadingCommas(output, { ...ctx, indentUnit: '    ' }), output);
});

test('does not wrap new lists when max line length is disabled', () => {
  const input = '\tCall(firstArgument, secondArgument, thirdArgument);';
  assert.equal(formatLeadingCommas(input, { ...ctx, enableWrapping: false }, 'chopAlways'), input);
});

test('treats compact relational expressions as separate arguments', () => {
  const input = 'Call(a<b,c>d, finalValue);';
  const output = formatLeadingCommas(input, { ...ctx, indentUnit: '    ' }, 'chopAlways');

  assert.equal(output, [
    'Call(a<b',
    '    , c>d',
    '    , finalValue',
    ');'
  ].join('\n'));
  assert.equal(formatLeadingCommas(output, { ...ctx, indentUnit: '    ' }, 'chopAlways'), output);
});

test('wraps realistic nested, named, lambda, and relational arguments safely', () => {
  const local = { ...ctx, wrapColumn: 70 };
  const cases = [
    '\tCall(new Dictionary<One, Two>(), Build(three, four), fifth).ToString();',
    '\tCall(first: GetValue(one, two), predicate: item => item.Enabled, cancellationToken: token);',
    '\tCall(firstValue < secondValue, thirdValue > fourthValue, finalValue);',
    '\tCall([first, second, third], new Model { Name = "a,b" }, finalValue);'
  ];

  for (const input of cases) {
    const output = formatLeadingCommas(input, local, 'chopAlways');
    assert.equal(stripWhitespace(output), stripWhitespace(input));
    assert.equal(formatLeadingCommas(output, local, 'chopAlways'), output);
  }
});

test('normalizes the reported UpdateManyAsync multiline argument case end to end', () => {
  const input = [
    'public static async Task UpdateLastMessageSentAt(this IRepository<Prospect> repository, List<string> prospectIds)',
    '\t{',
    '\t\tawait repository.Collection.UpdateManyAsync(',
    '\t\t\t\t_ => prospectIds.Contains(_.Id!),',
    '\t\t\tBuilders<Prospect>.Update',
    '\t\t\t    .Set(_ => _.UpdatedAt, DateTime.UtcNow)',
    '\t\t\t    .Set(_ => _.LastMessageSentAt, DateTime.UtcNow)',
    '\t\t);',
    '\t}',
    '}'
  ].join('\n');
  const settings = {
    normalizeIndentWhitespace: true,
    enableLeadingComma: true,
    enableFluentChainWrap: true,
    enableBlankLineRules: true,
    leadingCommaWrapStyle: 'wrapIfLong' as const
  };
  const local = { ...ctx, fluentChainMinSegments: 2, allowPartialFragment: true };
  const output = runFormatPasses(input, settings, local);

  assert.equal(output, [
    'public static async Task UpdateLastMessageSentAt(this IRepository<Prospect> repository, List<string> prospectIds)',
    '\t{',
    '\t\tawait repository.Collection.UpdateManyAsync(',
    '\t\t\t_ => prospectIds.Contains(_.Id!)',
    '\t\t\t, Builders<Prospect>.Update',
    '\t\t\t\t.Set(_ => _.UpdatedAt, DateTime.UtcNow)',
    '\t\t\t\t.Set(_ => _.LastMessageSentAt, DateTime.UtcNow)',
    '\t\t);',
    '\t}',
    '}'
  ].join('\n'));
  assert.equal(runFormatPasses(output, settings, local), output);
  assert.equal(stripWhitespace(output), stripWhitespace(input));
});

test('collapses repeated blank lines without removing region spacing', () => {
  const input = [
    '#region Password',
    '',
    '\tpublic void A()',
    '\t{',
    '',
    '\t\tGo();',
    '',
    '',
    '\t}',
    '',
    '#endregion'
  ].join('\n');

  const output = normalizeBlankLines(input);

  assert.equal(output, [
    '#region Password',
    '\tpublic void A()',
    '\t{',
    '\t\tGo();',
    '\t}',
    '#endregion'
  ].join('\n'));
  assert.equal(normalizeBlankLines(output), output);
});

test('preserves blank lines inside raw strings, verbatim strings, and block comments', () => {
  const input = [
    'var raw = """',
    'first',
    '',
    '',
    'second',
    '""";',
    'var verbatim = @"first',
    '',
    '',
    'second";',
    '/* first',
    '',
    '',
    'second */',
    '',
    '',
    'Done();'
  ].join('\n');
  const output = normalizeBlankLines(input);

  assert.equal(output, [
    'var raw = """',
    'first',
    '',
    '',
    'second',
    '""";',
    'var verbatim = @"first',
    '',
    '',
    'second";',
    '/* first',
    '',
    '',
    'second */',
    '',
    'Done();'
  ].join('\n'));
});

test('full pass pipeline is idempotent and preserves non-whitespace tokens', () => {
  const input = [
    '\tpublic CompanyRoleService(',
    '\t  IUnitOfWorkBase unitOfWork',
    '\t      , IServiceProvider serviceProvider',
    '\t\t)',
    '\t{',
    '',
    '\t\tvar x = repository.Query()',
    '\t\t\t.Where(_ => _.Id == id)',
    '\t\t\t\t.Select(_ => new Model()',
    '\t\t{',
    '\t\t\tId = _.Id',
    '\t\t})',
    '\t\t.ToList();',
    '',
    '',
    '\t}'
  ].join('\n');

  const settings = {
    normalizeIndentWhitespace: true,
    enableLeadingComma: true,
    enableFluentChainWrap: true,
    enableBlankLineRules: true,
    leadingCommaWrapStyle: 'wrapIfLong' as const
  };
  const output = runFormatPasses(input, settings, ctx);

  assert.equal(runFormatPasses(output, settings, ctx), output);
  assert.equal(stripWhitespace(output), stripWhitespace(input));
  assert.equal(output.includes('\t      ,'), false);
});

function stripWhitespace(text: string): string {
  return text.replace(/\s+/g, '');
}
