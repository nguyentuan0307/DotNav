import * as assert from 'assert';
import { test } from 'node:test';
import { UniversalSymbolIndex } from '../solutionSearch/searchScanner';
import { searchUniversalSymbols } from '../solutionSearch/searchEngine';

test('UniversalSymbolIndex finds exact, prefix, and substring symbols simultaneously', () => {
  const index = new UniversalSymbolIndex();

  // Populate 300 dummy symbols so getCandidates optimization is active
  for (let i = 0; i < 300; i++) {
    index.scanFileContent(`/dummy${i}.cs`, `public class Dummy${i} {\n  public int Prop${i} { get; set; }\n}`, 'Domain', `dummy${i}.cs`);
  }

  index.scanFileContent('/a.cs', 'public class RecordAppearance { }', 'Domain', 'a.cs');
  index.scanFileContent('/b.cs', 'public class Foo {\n  public RecordAppearance RecordAppearance { get; set; }\n}', 'Domain', 'b.cs');
  index.scanFileContent('/c.cs', 'public enum RecordAppearanceLayoutType {\n  Navigation,\n  OneContent,\n  TwoContent\n}', 'Domain', 'c.cs');
  index.scanFileContent('/d.cs', 'public class GetRecordAppearanceLayoutResponseV2 { }', 'Domain', 'd.cs');
  index.scanFileContent('/e.cs', 'public class Handler {\n  public void HandleRecordAppearanceLayoutAsync() {}\n}', 'Domain', 'e.cs');
  index.scanFileContent('/f.cs', 'public class Bar {\n  public RecordAppearanceLayoutType DefaultType { get; set; }\n}', 'Domain', 'f.cs');

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
  assert.ok(resultNames.some(n => n.startsWith('HandleRecordAppearanceLayoutAsync')));
  assert.ok(resultNames.some(n => n.startsWith('DefaultType')));
});

test('UniversalSymbolIndex supports clear and rescan lifecycle', () => {
  const index = new UniversalSymbolIndex();
  index.scanFileContent('/App.cs', 'public class AppService { }', 'App', 'App.cs');
  index.markFullScanCompleted();

  assert.equal(index.count, 1);
  assert.equal(index.isFullScanCompleted, true);

  // Clear on branch switch
  index.clear();
  assert.equal(index.count, 0);
  assert.equal(index.isFullScanCompleted, false);

  // Rescan new branch content
  index.scanFileContent('/NewApp.cs', 'public class NewAppService { }', 'NewApp', 'NewApp.cs');
  index.markFullScanCompleted();
  assert.equal(index.count, 1);
  assert.equal(index.isFullScanCompleted, true);
  assert.equal(index.getAllSymbols()[0].name, 'NewAppService');
});

