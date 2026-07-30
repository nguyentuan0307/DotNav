import assert from 'assert/strict';
import test from 'node:test';
import { buildCSharpFluentChainModel } from '../format/csharpFluentChainModel';

test('groups same-depth fluent calls across a multiline predicate', () => {
  const input = [
    '\tvar ids = await repository',
    '\t\t.GetQuery(item => item.Enabled',
    '\t\t\t&& item.Status == Status.Active',
    '\t\t\t&& item.ReferenceId.HasValue)',
    '\t\t.OrderBy(item => item.Id)',
    '\t\t.Select(item => item.Id)',
    '\t\t.ToListAsync(cancellationToken);'
  ].join('\n');

  const chains = buildCSharpFluentChainModel(input);

  assert.equal(chains.length, 1);
  assert.equal(chains[0].rootLine, 0);
  assert.deepEqual(chains[0].continuationLines, [1, 4, 5, 6]);
});

test('keeps nested fluent calls separate from their outer lambda chain', () => {
  const input = [
    '\tvar models = source',
    '\t\t.Select(item =>',
    '\t\t{',
    '\t\t\tvar children = item.Children',
    '\t\t\t\t.Where(child => child.Enabled)',
    '\t\t\t\t.Select(child => child.Id)',
    '\t\t\t\t.ToList();',
    '\t\t\treturn children;',
    '\t\t})',
    '\t\t.ToList();'
  ].join('\n');

  const chains = buildCSharpFluentChainModel(input);

  assert.equal(chains.length, 2);
  assert.deepEqual(chains[0].continuationLines, [1, 9]);
  assert.deepEqual(chains[1].continuationLines, [4, 5, 6]);
  assert.equal(chains[1].rootLine, 3);
});

test('does not include object initializer body lines in fluent alignment', () => {
  const input = [
    '\tvar models = source',
    '\t\t.Select(sort => new ViewSortMigrationModel',
    '\t\t{',
    '\t\t\tProjectViewId = sort.ViewId!.Value,',
    '\t\t\tFieldId = sort.FieldId,',
    '\t\t})',
    '\t\t.ToList();'
  ].join('\n');

  const chain = buildCSharpFluentChainModel(input)[0];

  assert.deepEqual(chain.continuationLines, [1, 6]);
  assert.deepEqual(chain.attachedCommentLines, []);
});
