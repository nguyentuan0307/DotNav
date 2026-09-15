import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import { UniversalSymbolIndex } from '../solutionSearch/searchScanner';
import { searchUniversalSymbols } from '../solutionSearch/searchEngine';

const Module = require('module');
const originalLoad = Module._load;
Module._load = function(request: string, parent: any, isMain: boolean) {
  if (request === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: () => undefined }), workspaceFolders: [] },
      window: { showInformationMessage: () => Promise.resolve() },
      extensions: { getExtension: () => undefined }
    };
  }
  return originalLoad(request, parent, isMain);
};

const {
  getCurrentGitBranch,
  getCacheFilePath,
  getStoredFrecency,
  recordSymbolAccess,
  getStoredAdaptiveClicks,
  recordAdaptiveClick,
  resetSearchLearningCommand
} = require('../solutionSearch/searchCommands');

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

  assert.equal(index.count, 2); // Class and File
  assert.equal(index.isFullScanCompleted, true);

  // Clear on branch switch
  index.clear();
  assert.equal(index.count, 0);
  assert.equal(index.isFullScanCompleted, false);

  // Rescan new branch content
  index.scanFileContent('/NewApp.cs', 'public class NewAppService { }', 'NewApp', 'NewApp.cs');
  index.markFullScanCompleted();
  assert.equal(index.count, 2);
  assert.equal(index.isFullScanCompleted, true);
  assert.ok(index.getAllSymbols().some(s => s.name === 'NewAppService'));
});

test('UniversalSymbolIndex parses and searches partial controller endpoints with route constraints and wildcard slashes', () => {
  const index = new UniversalSymbolIndex();
  const partialControllerCode = `
using Microsoft.AspNetCore.Mvc;

namespace ELDesk.Work.API
{
	public partial class ProjectController
	{
		[HttpPost("{projectId:int}/invite")]
		[FeatureAccessControl(AccessControlBusinessType.Project, FeatureKey.Project_Member_Invite)]
		public async Task<Guid> InviteUserToProject([FromRoute] int projectId, [FromBody] InviteUserToProjectRequest request)
		{
			return await _app.InviteUserToProjectAsync(projectId, request);
		}
	}
}`;

  index.scanFileContent('/src/API/ProjectController.Invite.cs', partialControllerCode, 'ELDesk.Work', 'API/ProjectController.Invite.cs');
  index.markFullScanCompleted();

  const query1 = searchUniversalSymbols(index, 'projects//invite');
  assert.ok(query1.length > 0, 'projects//invite should match ProjectController invite endpoint');
  assert.ok(query1.some(r => r.symbol.kind === 'endpoint' && r.symbol.name.includes('invite')));

  const query2 = searchUniversalSymbols(index, 'projects/invite');
  assert.ok(query2.length > 0, 'projects/invite should match ProjectController invite endpoint');

  const query3 = searchUniversalSymbols(index, 'InviteUserToProject');
  assert.ok(query3.length > 0, 'InviteUserToProject should match action method');
});

test('UniversalSymbolIndex parses interface methods, record constructor properties, and constants', () => {
  const index = new UniversalSymbolIndex();
  const code = `
namespace MySolution
{
    public interface IProjectService
    {
        Task<Guid> InviteUserToProjectAsync(int projectId, InviteUserToProjectRequest request);
        Task<ProjectDto> GetProjectByIdAsync(int id);
    }

    public record CreateProjectRequest(string Name, string Description, int OwnerId);

    public static class FeatureKey
    {
        public const string Project_Member_Invite = "Project.Member.Invite";
    }
}`;

  index.scanFileContent('/src/AllInOne.cs', code, 'MySolution', 'AllInOne.cs');
  const symbols = index.getAllSymbols();

  assert.ok(symbols.some(s => s.kind === 'method' && s.name.startsWith('InviteUserToProjectAsync')));
  assert.ok(symbols.some(s => s.kind === 'property' && s.name.startsWith('Name')));
  assert.ok(symbols.some(s => s.kind === 'property' && s.name.startsWith('Project_Member_Invite')));
});

test('UniversalSymbolIndex parses .resx localization and inline throw new Exception messages', () => {
  const index = new UniversalSymbolIndex();

  const resxContent = `<?xml version="1.0" encoding="utf-8"?>
<root>
  <data name="ApplicationNotFound" xml:space="preserve">
    <value>Không tìm thấy ứng dụng</value>
  </data>
</root>`;

  const csharpCode = `
public class ProjectService
{
    public void Validate()
    {
        throw new BadRequestException("Người dùng đã được mời vào doanh nghiệp");
    }
}`;

  index.scanFileContent('/src/ErrorMessages.resx', resxContent, 'ELDesk.CustomApp', 'ErrorMessages.resx');
  index.scanFileContent('/src/ProjectService.cs', csharpCode, 'ELDesk.Work', 'ProjectService.cs');
  index.markFullScanCompleted();

  const resxQuery = searchUniversalSymbols(index, 'Không tìm thấy ứng dụng');
  assert.ok(resxQuery.length > 0, 'Should find resx message by Vietnamese text');
  assert.equal(resxQuery[0].symbol.metadata?.configValue, 'Không tìm thấy ứng dụng');

  const unaccentedQuery = searchUniversalSymbols(index, 'khong tim thay ung dung');
  assert.ok(unaccentedQuery.length > 0, 'Should find resx message by unaccented Vietnamese text');

  const partialUnaccentedQuery = searchUniversalSymbols(index, 'tim thay ung dung');
  assert.ok(partialUnaccentedQuery.length > 0, 'Should find resx message by partial unaccented query');

  const keyQuery = searchUniversalSymbols(index, 'ApplicationNotFound');
  assert.ok(keyQuery.length > 0, 'Should find resx by key name');

  const inlineQuery = searchUniversalSymbols(index, 'Người dùng đã được mời vào doanh nghiệp');
  assert.ok(inlineQuery.length > 0, 'Should find inline throw new Exception message');
  assert.ok(inlineQuery[0].symbol.name.includes('Người dùng đã được mời vào doanh nghiệp'));

  const inlineUnaccentedQuery = searchUniversalSymbols(index, 'nguoi dung da duoc moi');
  assert.ok(inlineUnaccentedQuery.length > 0, 'Should find inline throw message by unaccented query');
});

test('UniversalSymbolIndex getFilePaths tracks active cached files accurately', () => {
  const index = new UniversalSymbolIndex();
  index.scanFileContent('/repo/A.cs', 'public class A {}', 'App', 'A.cs');
  index.scanFileContent('/repo/B.cs', 'public class B {}', 'App', 'B.cs');
  assert.deepEqual(index.getFilePaths().sort(), ['/repo/A.cs', '/repo/B.cs'].sort());

  index.invalidateFile('/repo/A.cs');
  assert.deepEqual(index.getFilePaths(), ['/repo/B.cs']);

  index.clear();
  assert.deepEqual(index.getFilePaths(), []);
});

test('getCurrentGitBranch extracts branch name from git repo and isolates cache file', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotnav-git-branch-test-'));
  try {
    const gitDir = path.join(tempDir, '.git');
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/feature/auth-v2\n', 'utf8');

    const branch = getCurrentGitBranch(tempDir);
    assert.equal(branch, 'feature/auth-v2');

    const fakeContext = {
      storageUri: { fsPath: tempDir }
    } as any;
    const cachePath = getCacheFilePath(fakeContext, tempDir);
    assert.ok(cachePath);
    assert.match(cachePath, /dotnav_search_cache_feature_auth-v2\.json\.gz/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Persistent frecency records access, sorts by frecency score, and prunes ghost symbols', async () => {
  const store = new Map<string, any>();
  const fakeContext: any = {
    workspaceState: {
      get: (key: string, defaultVal: any) => store.has(key) ? store.get(key) : defaultVal,
      update: async (key: string, value: any) => { store.set(key, value); }
    }
  };

  const knownIds = new Set(['sym-1', 'sym-2']);

  // Initial read is empty
  assert.deepEqual(getStoredFrecency(fakeContext, knownIds), []);

  // Record access to sym-1 twice, sym-2 once, and a ghost sym-3
  await recordSymbolAccess('sym-1', fakeContext, knownIds);
  await recordSymbolAccess('sym-1', fakeContext, knownIds);
  await recordSymbolAccess('sym-2', fakeContext, knownIds);

  // Directly insert a ghost symbol into store
  const rawList = store.get('dotnav.search.frecencyRecords');
  rawList.push({ symbolId: 'ghost-symbol-deleted', count: 10, lastAccessedAt: Date.now() });
  store.set('dotnav.search.frecencyRecords', rawList);

  // Read with knownIds -> ghost symbol is pruned!
  const loaded = getStoredFrecency(fakeContext, knownIds);
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].symbolId, 'sym-1');
  assert.equal(loaded[0].count, 2);
  assert.equal(loaded[1].symbolId, 'sym-2');
  assert.equal(loaded[1].count, 1);
});

test('Local Adaptive Ranking records query associations and supports reset', async () => {
  const store = new Map<string, any>();
  const fakeContext: any = {
    workspaceState: {
      get: (key: string, defaultVal: any) => store.has(key) ? store.get(key) : defaultVal,
      update: async (key: string, value: any) => { store.set(key, value); }
    }
  };

  // Initially empty
  assert.deepEqual(getStoredAdaptiveClicks(fakeContext), {});

  // Record click for query "order" -> "OrderController"
  await recordAdaptiveClick('order', 'OrderController', fakeContext);
  await recordAdaptiveClick('order', 'OrderController', fakeContext);
  await recordAdaptiveClick('order', 'OrderService', fakeContext);

  const clicks = getStoredAdaptiveClicks(fakeContext);
  assert.ok(clicks['order']);
  assert.equal(clicks['order']['OrderController'].count, 2);
  assert.equal(clicks['order']['OrderService'].count, 1);

  // Reset clears all data
  await resetSearchLearningCommand(fakeContext);
  const clicksAfterReset = getStoredAdaptiveClicks(fakeContext);
  assert.deepEqual(clicksAfterReset, {});
});

test('UniversalSymbolIndex synthesizes routes from [FromRoute] params and finds get data-entities/235/forms/124', () => {
  const index = new UniversalSymbolIndex();
  const code = `
public partial class DataEntityFormController
{
	[FeatureAccessControl(AccessControlBusinessType.AppBuilder, FeatureKey.App_Start_Form_View)]
	[HttpGet("{formId:int}")]
	public async Task<FormDetailsResponse> GetFormDetails([FromRoute] int appId
		, [FromRoute] int dataEntityId
		, [FromRoute] int formId
		, CancellationToken cancellationToken)
	{
		return await _formService.GetFormDetailsAsync(appId, dataEntityId, formId, cancellationToken);
	}
}
`;

  index.scanFileContent('/src/Controllers/DataEntityFormController.cs', code, 'CustomApp', 'Controllers/DataEntityFormController.cs');
  index.markFullScanCompleted();

  const query = searchUniversalSymbols(index, 'get data-entities/235/forms/124');
  assert.ok(query.length > 0, 'Should find endpoint for get data-entities/235/forms/124');
  const topResult = query[0];
  assert.equal(topResult.symbol.kind, 'endpoint');
  assert.equal(topResult.score, 100);
  assert.equal(topResult.symbol.containerName, 'DataEntityFormController');
  assert.ok(
    topResult.symbol.metadata?.routeTemplate?.includes('data-entities') &&
    topResult.symbol.metadata?.routeTemplate?.includes('forms')
  );
});

test('UniversalSymbolIndex scans each partial controller file once without replaying source', () => {
  class CountingUniversalSymbolIndex extends UniversalSymbolIndex {
    public scanCount = 0;

    public override scanFileContent(
      filePath: string,
      content: string,
      projectName: string,
      relativePath: string,
      mtime?: number
    ) {
      this.scanCount++;
      return super.scanFileContent(filePath, content, projectName, relativePath, mtime);
    }
  }

  const firstFile = `
public partial class DataEntityFormController
{
	[HttpGet("first")]
	public IActionResult First() => Ok();
}
`;
  const secondFile = `
[Route("api/apps/{appId}/data-entities/{dataEntityId}/forms")]
public partial class DataEntityFormController : ControllerBase
{
	[HttpGet("second")]
	public IActionResult Second() => Ok();
}
`;

  const index = new CountingUniversalSymbolIndex();
  index.scanFileContent('/src/DataEntityFormController.First.cs', firstFile, 'MyProj', 'DataEntityFormController.First.cs');
  index.scanFileContent('/src/DataEntityFormController.Second.cs', secondFile, 'MyProj', 'DataEntityFormController.Second.cs');

  assert.equal(index.scanCount, 2);
});

test('DiskSymbolStore specificity-weighted ranking finds target method despite 100+ generic Get... methods', () => {
  const { DiskSymbolStore } = require('../solutionSearch/searchDiskStore');
  const disk = new DiskSymbolStore();

  // Populate 25 files with generic Get... methods
  for (let f = 1; f <= 25; f++) {
    const dummySymbols: any[] = [];
    for (let m = 1; m <= 5; m++) {
      dummySymbols.push({
        name: `GetGenericData${f}_${m}Async(int id)`,
        kind: 'method',
        filePath: `/src/Services/GenericService${f}.cs`,
        relativePath: `Services/GenericService${f}.cs`,
        projectName: 'MyProj',
        line: m * 10,
        column: 1
      });
    }
    disk.registerFileSymbols(`/src/Services/GenericService${f}.cs`, `Services/GenericService${f}.cs`, 'MyProj', dummySymbols);
  }

  // Register real target method
  disk.registerFileSymbols('/src/Services/SpecificationService.cs', 'Services/SpecificationService.cs', 'MyProj', [
    {
      name: 'GetSpecificationPrefillValueAsync(int id, CancellationToken ct)',
      kind: 'method',
      filePath: '/src/Services/SpecificationService.cs',
      relativePath: 'Services/SpecificationService.cs',
      projectName: 'MyProj',
      line: 45,
      column: 1,
      metadata: {
        returnType: 'Task<FormDetailsResponse>'
      }
    }
  ]);

  // Query with full name
  const res1 = disk.searchColdSymbols(['GetSpecificationPrefillValueAsync']);
  assert.ok(res1.length > 0, 'Must find GetSpecificationPrefillValueAsync in cold store');
  assert.equal(res1[0].name, 'GetSpecificationPrefillValueAsync(int id, CancellationToken ct)');
  assert.equal(res1[0].filePath, '/src/Services/SpecificationService.cs');

  // Query without Async
  const res2 = disk.searchColdSymbols(['GetSpecificationPrefillValue']);
  assert.ok(res2.length > 0, 'Must find GetSpecificationPrefillValue in cold store');
  assert.equal(res2[0].name, 'GetSpecificationPrefillValueAsync(int id, CancellationToken ct)');
  assert.equal(res2[0].filePath, '/src/Services/SpecificationService.cs');
});

test('UniversalSymbolIndex parses explicit interface implementations and partial methods', () => {
  const index = new UniversalSymbolIndex();
  const code = `
public partial class SpecificationService : ISpecificationService
{
    Task<SpecificationPrefillValueResponse> ISpecificationService.GetSpecificationPrefillValueAsync(int id, CancellationToken ct)
    {
        return null;
    }

    partial void OnPrefill(int id);
}
`;

  index.scanFileContent('/src/SpecificationService.cs', code, 'MyProj', 'SpecificationService.cs');
  index.markFullScanCompleted();

  const symbols = index.getAllSymbols();
  assert.ok(symbols.some(s => s.kind === 'method' && s.name.startsWith('GetSpecificationPrefillValueAsync')));
  assert.ok(symbols.some(s => s.kind === 'method' && s.name.startsWith('OnPrefill')));

  const searchRes = searchUniversalSymbols(index, 'GetSpecificationPrefillValueAsync');
  assert.ok(searchRes.length > 0, 'Should search explicit interface implementation');
  assert.ok(searchRes[0].symbol.name.startsWith('GetSpecificationPrefillValueAsync'));
});
