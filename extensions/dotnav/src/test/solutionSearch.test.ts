import * as assert from 'assert';
import { test } from 'node:test';
import { UniversalSymbolIndex } from '../solutionSearch/searchScanner';
import { searchUniversalSymbols } from '../solutionSearch/searchEngine';

test('UniversalSymbolIndex finds exact, prefix, and substring symbols simultaneously', () => {
  const index = new UniversalSymbolIndex();

  // Populate 300 dummy symbols so getCandidates optimization is active
  for (let i = 0; i < 300; i++) {
    index.scanFileContent(`/dummy${i}.cs`, `public class Dummy${i} { public int Prop${i} { get; set; } }`, 'Domain', `dummy${i}.cs`);
  }

  index.scanFileContent('/a.cs', 'public class RecordAppearance { }', 'Domain', 'a.cs');
  index.scanFileContent('/b.cs', 'public class Foo { public RecordAppearance RecordAppearance { get; set; } }', 'Domain', 'b.cs');
  index.scanFileContent('/c.cs', 'public enum RecordAppearanceLayoutType { Navigation, OneContent, TwoContent }', 'Domain', 'c.cs');
  index.scanFileContent('/d.cs', 'public class GetRecordAppearanceLayoutResponseV2 { }', 'Domain', 'd.cs');
  index.scanFileContent('/e.cs', 'public class Handler { public void HandleRecordAppearanceLayoutAsync() {} }', 'Domain', 'e.cs');
  index.scanFileContent('/f.cs', 'public class Bar { public RecordAppearanceLayoutType DefaultType { get; set; } }', 'Domain', 'f.cs');

  const results = searchUniversalSymbols(index, 'RecordAppearance');
  const resultNames = results.map(r => r.symbol.name);

  // Exact matches must be present at top
  assert.ok(resultNames.includes('RecordAppearance'));
  // Prefix matches must also be present
  assert.ok(resultNames.includes('RecordAppearanceLayoutType'));
  assert.ok(resultNames.includes('RecordAppearanceLayoutType.Navigation'));
  assert.ok(resultNames.includes('RecordAppearanceLayoutType.OneContent'));
  // Substring matches must be present
  assert.ok(resultNames.includes('GetRecordAppearanceLayoutResponseV2'));
  assert.ok(resultNames.includes('HandleRecordAppearanceLayoutAsync'));
  assert.ok(resultNames.includes('DefaultType'));
});
