import assert from 'assert/strict';
import test from 'node:test';
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
  fluentChainMinSegments: 3
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

  assert.ok(output.includes('\n\t\t, secondArgument'));
  assert.ok(output.endsWith('\n\t);'));
  assert.equal(formatLeadingCommas(output, ctx), output);
});

test('normalizes fluent chain indentation and object initializer inside chain', () => {
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
    '\t\t{',
    '\t\tSortFieldType = _.Type',
    '\t\t})',
    '\t\t.ToList();'
  ].join('\n'));
  assert.equal(formatFluentChains(output, ctx), output);
});

test('leaves short fluent chains below threshold unchanged', () => {
  const input = [
    '\tvar models = source',
    '\t\t\t.Where(_ => _.Enabled)',
    '\t\t.ToList();'
  ].join('\n');

  assert.equal(formatFluentChains(input, ctx), input);
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
    enableBlankLineRules: true
  };
  const output = runFormatPasses(input, settings, ctx);

  assert.equal(runFormatPasses(output, settings, ctx), output);
  assert.equal(stripWhitespace(output), stripWhitespace(input));
  assert.equal(output.includes('\t      ,'), false);
});

function stripWhitespace(text: string): string {
  return text.replace(/\s+/g, '');
}
