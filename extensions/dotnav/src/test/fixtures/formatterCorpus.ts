export type FormatterCorpusKind = 'leadingCommaChop' | 'leadingCommaDefault' | 'fluentChain' | 'blankLines';
export type FormatterCorpusState = 'bad-format' | 'well-formatted' | 'malformed';

export class FormatterCorpusCase {
  constructor(
    readonly name: string,
    readonly category: string,
    readonly state: FormatterCorpusState,
    readonly formatter: FormatterCorpusKind,
    readonly input: string,
    readonly expected: string
  ) {}
}

interface SingleLineListDefinition {
  name: string;
  prefix: string;
  items: string[];
  suffix: string;
}

interface MultilineListDefinition {
  name: string;
  invocation: string;
  items: string[];
}

const singleLineLists: SingleLineListDefinition[] = [
  { name: 'method-call', prefix: 'Call', items: ['firstArgument', 'secondArgument', 'thirdArgument'], suffix: ';' },
  { name: 'object-creation', prefix: 'new Service', items: ['dependency', 'logger', 'clock'], suffix: ';' },
  { name: 'nested-calls', prefix: 'Call', items: ['Build(one, two)', 'Transform(three, four)', 'finalValue'], suffix: ';' },
  { name: 'generic-values', prefix: 'Call', items: ['new Dictionary<One, Two>()', 'new Pair<Three, Four>()', 'finalValue'], suffix: ';' },
  { name: 'named-arguments', prefix: 'Call', items: ['first: one', 'second: GetValue(two, three)', 'cancellationToken: token'], suffix: ';' },
  { name: 'lambda-argument', prefix: 'Call', items: ['source', 'item => item.Enabled && item.Name == "active"', 'cancellationToken'], suffix: ';' },
  { name: 'tuple-arguments', prefix: 'Call', items: ['(one, two)', '(three, four)', 'finalValue'], suffix: ';' },
  { name: 'collection-expressions', prefix: 'Call', items: ['[one, two, three]', '[four, five, six]', 'finalValue'], suffix: ';' },
  { name: 'object-initializer', prefix: 'Call', items: ['new Model { Name = "one,two", Enabled = true }', 'other', 'finalValue'], suffix: ';' },
  { name: 'regular-strings', prefix: 'Call', items: ['""', '"one,two"', '"three(four)"'], suffix: ';' },
  { name: 'verbatim-string', prefix: 'Call', items: ['@"one,two(three)"', 'secondValue', 'finalValue'], suffix: ';' },
  { name: 'raw-string', prefix: 'Call', items: ['"""one,two(three)"""', 'secondValue', 'finalValue'], suffix: ';' },
  { name: 'char-literals', prefix: 'Call', items: ["','", "'('", 'finalValue'], suffix: ';' },
  { name: 'relational-spaced', prefix: 'Call', items: ['first < second', 'third > fourth', 'finalValue'], suffix: ';' },
  { name: 'relational-compact', prefix: 'Call', items: ['a<b', 'c>d', 'finalValue'], suffix: ';' },
  { name: 'null-operators', prefix: 'Call', items: ['first ?? fallback', 'second?.Value', 'third!.Value'], suffix: ';' },
  { name: 'type-operators', prefix: 'Call', items: ['typeof(Dictionary<One, Two>)', 'nameof(Model.Value)', 'default(CancellationToken)'], suffix: ';' },
  { name: 'ternary-values', prefix: 'Call', items: ['condition ? first : second', 'otherCondition ? third : fourth', 'finalValue'], suffix: ';' },
  { name: 'record-constructor', prefix: 'public record Message', items: ['string Identifier', 'DateTime CreatedAt', 'IReadOnlyList<string> Values'], suffix: ';' },
  { name: 'attribute-arguments', prefix: '[Example', items: ['typeof(Dictionary<One, Two>)', 'Name = "one,two"', 'Enabled = true'], suffix: ']' }
];

const multilineLists: MultilineListDefinition[] = [
  { name: 'service-constructor', invocation: 'public Service', items: ['IDependency dependency', 'ILogger<Service> logger', 'IClock clock'] },
  { name: 'async-call', invocation: 'await ExecuteAsync', items: ['request', 'options', 'cancellationToken'] },
  { name: 'repository-call', invocation: 'repository.Update', items: ['entity', 'auditContext', 'cancellationToken'] },
  { name: 'mediator-publish', invocation: 'await mediator.Publish', items: ['new DomainEvent(record.Id)', 'tenantId', 'cancellationToken'] },
  { name: 'builder-call', invocation: 'Builders<Model>.Update.Combine', items: ['firstUpdate', 'secondUpdate', 'thirdUpdate'] },
  { name: 'named-multiline', invocation: 'Create', items: ['name: model.Name', 'enabled: model.Enabled', 'owner: currentUser'] },
  { name: 'nested-multiline', invocation: 'Outer', items: ['Inner(one, two)', 'Transform(three, four)', 'finalValue'] },
  { name: 'strings-multiline', invocation: 'Write', items: ['"one,two"', '@"three,four"', '"""five,six"""'] },
  { name: 'collections-multiline', invocation: 'Merge', items: ['[one, two]', 'new[] { three, four }', 'finalValue'] },
  { name: 'predicates-multiline', invocation: 'Filter', items: ['source', 'item => item.Enabled', 'cancellationToken'] }
];

const fluentDefinitions = [
  ['linq-query', 'source', ['.Where(x => x.Enabled)', '.Select(x => x.Id)', '.ToList()']],
  ['async-chain', 'operation', ['.ConfigureAwait(false)', '.GetAwaiter()', '.GetResult()']],
  ['mongo-update', 'Builders<Model>.Update', ['.Set(x => x.Name, name)', '.Set(x => x.Enabled, true)', '.CurrentDate(x => x.UpdatedAt)']],
  ['string-builder', 'builder', ['.Append(first)', '.Append(second)', '.AppendLine(third)']],
  ['configuration', 'configuration', ['.GetSection("Feature")', '.Get<FeatureOptions>()', '.Validate()']],
  ['http-request', 'request', ['.WithHeader("x-id", id)', '.WithTimeout(timeout)', '.SendAsync()']],
  ['nullable-chain', 'source', ['?.Where(x => x.Enabled)', '?.Select(x => x.Id)', '?.ToList()']],
  ['query-ordering', 'query', ['.OrderBy(x => x.Name)', '.ThenBy(x => x.Id)', '.Take(limit)']],
  ['task-chain', 'task', ['.ContinueWith(Handle)', '.Unwrap()', '.ConfigureAwait(false)']],
  ['json-chain', 'document.RootElement', ['.GetProperty("items")', '.EnumerateArray()', '.ToArray()']],
  ['logging-chain', 'logger', ['.ForContext("Id", id)', '.ForContext<Model>()', '.Information("Saved")']],
  ['validation-chain', 'rule', ['.NotNull()', '.WithMessage("Required")', '.When(x => x.Enabled)']],
  ['observable-chain', 'stream', ['.Where(x => x.Enabled)', '.SelectMany(Load)', '.Subscribe(Handle)']],
  ['filesystem-chain', 'path', ['.Normalize()', '.EnsureDirectory()', '.Write(content)']],
  ['mapping-chain', 'mapper', ['.CreateMap<Source, Target>()', '.ForMember(x => x.Id, MapId)', '.ReverseMap()']]
] as const;

const blankLineDefinitions = [
  ['method-body', ['void Execute()', '{', '', '', '    Run();', '', '', '}'], ['void Execute()', '{', '    Run();', '}']],
  ['type-body', ['class Service', '{', '', '', '    private int value;', '', '', '}'], ['class Service', '{', '    private int value;', '}']],
  ['region', ['#region Commands', '', '', 'void Run();', '', '', '#endregion'], ['#region Commands', 'void Run();', '#endregion']],
  ['between-members', ['void First() { }', '', '', '', 'void Second() { }'], ['void First() { }', '', 'void Second() { }']],
  ['nested-block', ['if (enabled)', '{', '', '', '    Execute();', '', '', '}'], ['if (enabled)', '{', '    Execute();', '}']]
] as const;

export const badFormatCorpus: FormatterCorpusCase[] = [
  ...singleLineLists.map(definition => {
    const input = `${definition.prefix}(${definition.items.join(', ')})${definition.suffix}`;
    const expected = [
      `${definition.prefix}(${definition.items[0]}`,
      ...definition.items.slice(1).map(item => `    , ${item}`),
      `)${definition.suffix}`
    ].join('\n');
    return new FormatterCorpusCase(
      `bad-single-line-${definition.name}`,
      'single-line lists',
      'bad-format',
      'leadingCommaChop',
      input,
      expected
    );
  }),
  ...multilineLists.map(definition => {
    const input = [
      `${definition.invocation}(`,
      ...definition.items.map((item, index) => `      ${item}${index < definition.items.length - 1 ? ',' : ''}`),
      '  );'
    ].join('\n');
    const expected = [
      `${definition.invocation}(`,
      `    ${definition.items[0]}`,
      ...definition.items.slice(1).map(item => `    , ${item}`),
      ');'
    ].join('\n');
    return new FormatterCorpusCase(
      `bad-multiline-${definition.name}`,
      'multiline trailing commas',
      'bad-format',
      'leadingCommaDefault',
      input,
      expected
    );
  }),
  ...fluentDefinitions.map(([name, root, segments]) => {
    const input = [
      `var value = ${root}`,
      ...segments.map((segment, index) =>
        `${'    '.repeat(index + 2)}${segment}${index === segments.length - 1 ? ';' : ''}`)
    ].join('\n');
    const expected = [
      `var value = ${root}`,
      ...segments.map((segment, index) =>
        `    ${segment}${index === segments.length - 1 ? ';' : ''}`)
    ].join('\n');
    return new FormatterCorpusCase(
      `bad-fluent-${name}`,
      'fluent chains',
      'bad-format',
      'fluentChain',
      input,
      expected
    );
  }),
  ...blankLineDefinitions.map(([name, input, expected]) =>
    new FormatterCorpusCase(
      `bad-blank-lines-${name}`,
      'blank lines',
      'bad-format',
      'blankLines',
      input.join('\n'),
      expected.join('\n')
    ))
];

export const wellFormattedCorpus: FormatterCorpusCase[] = badFormatCorpus.map(value =>
  new FormatterCorpusCase(
    value.name.replace(/^bad-/, 'good-'),
    value.category,
    'well-formatted',
    value.formatter,
    value.expected,
    value.expected
  ));

const malformedInputs: Array<[string, string]> = [
  ['missing-close-paren', 'Call(first, second, third;'],
  ['missing-open-paren', 'first, second, third);'],
  ['missing-close-bracket', 'Call([first, second, third);'],
  ['missing-close-brace', 'Call(new Model { Name = "value", second);'],
  ['extra-close-paren', 'Call(first, second, third));'],
  ['extra-close-bracket', 'Call(first, second], third);'],
  ['extra-close-brace', 'Call(first, second}, third);'],
  ['unterminated-string', 'Call("first, second, third);'],
  ['unterminated-verbatim-string', 'Call(@"first, second, third);'],
  ['unterminated-raw-string', 'Call("""first, second, third);'],
  ['unterminated-char', "Call('x, second, third);"],
  ['unterminated-block-comment', 'Call(first, /* second, third);'],
  ['double-comma', 'Call(first,,second);'],
  ['leading-empty-argument', 'Call(,first,second);'],
  ['trailing-empty-argument', 'Call(first,second,);'],
  ['broken-generic', 'Call(new Dictionary<One, Two(), second, third);'],
  ['broken-lambda', 'Call(source, item => { return item.Enabled;, token);'],
  ['broken-collection', 'Call([first, second, third, finalValue);'],
  ['broken-interpolation', 'Call($"value={Get(one, two)", second, third);'],
  ['mixed-comment-directive', ['Call(', '    first,', '#if FEATURE', '    // optional', '    second,', '#endif', '    third', ');'].join('\n')]
];

export const malformedCorpus: FormatterCorpusCase[] = malformedInputs.map(([name, input]) =>
  new FormatterCorpusCase(
    `malformed-${name}`,
    'malformed or ambiguous',
    'malformed',
    'leadingCommaChop',
    input,
    input
  ));

export const formatterCorpus = [
  ...badFormatCorpus,
  ...wellFormattedCorpus,
  ...malformedCorpus
];
