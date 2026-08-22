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

  const keyQuery = searchUniversalSymbols(index, 'ApplicationNotFound');
  assert.ok(keyQuery.length > 0, 'Should find resx by key name');

  const inlineQuery = searchUniversalSymbols(index, 'Người dùng đã được mời vào doanh nghiệp');
  assert.ok(inlineQuery.length > 0, 'Should find inline throw new Exception message');
  assert.ok(inlineQuery[0].symbol.name.includes('Người dùng đã được mời vào doanh nghiệp'));
});


