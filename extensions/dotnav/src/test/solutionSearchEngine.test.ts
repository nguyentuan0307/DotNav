import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isCamelCaseAcronymMatch,
  isNearMatch,
  parseUniversalSearchQuery,
  searchUniversalSymbols
} from '../solutionSearch/searchEngine';
import { UniversalSymbol } from '../solutionSearch/searchModel';

const sampleSymbols: UniversalSymbol[] = [
  {
    id: '1',
    name: 'GET /api/custom-app/apps/{appId}/fields/{fieldId}/validation',
    kind: 'endpoint',
    filePath: '/src/Controllers/FieldController.cs',
    relativePath: 'Controllers/FieldController.cs',
    projectName: 'ELDesk.CustomApp',
    line: 100,
    column: 1,
    metadata: {
      httpMethod: 'GET',
      routeTemplate: 'api/custom-app/apps/{appId}/fields/{fieldId}/validation',
      controllerName: 'FieldController',
      actionName: 'ValidateField'
    }
  },
  {
    id: '2',
    name: 'CreateInterfaceViewCommand',
    kind: 'cqrs_command',
    filePath: '/src/Commands/CreateInterfaceViewCommand.cs',
    relativePath: 'Commands/CreateInterfaceViewCommand.cs',
    projectName: 'ELDesk.Work',
    line: 12,
    column: 1
  },
  {
    id: '3',
    name: 'CreateInterfaceViewCommandHandler',
    kind: 'cqrs_handler',
    filePath: '/src/Handlers/CreateInterfaceViewCommandHandler.cs',
    relativePath: 'Handlers/CreateInterfaceViewCommandHandler.cs',
    projectName: 'ELDesk.Work',
    line: 25,
    column: 1
  },
  {
    id: '4',
    name: 'DbSet<AppEntity> Apps',
    kind: 'ef_dbset',
    filePath: '/src/Data/AppDbContext.cs',
    relativePath: 'Data/AppDbContext.cs',
    projectName: 'ELDesk.Data',
    line: 18,
    column: 1
  },
  {
    id: '5',
    name: 'IInterfaceViewService',
    kind: 'interface',
    filePath: '/src/Services/IInterfaceViewService.cs',
    relativePath: 'Services/IInterfaceViewService.cs',
    projectName: 'Cleeksy.Interface',
    line: 5,
    column: 1
  }
];

test('parseUniversalSearchQuery extracts prefixes and filter modes', () => {
  assert.equal(parseUniversalSearchQuery('/fields//validation').filterMode, 'endpoints');
  assert.equal(parseUniversalSearchQuery('$CreateOrder').filterMode, 'cqrs');
  assert.equal(parseUniversalSearchQuery('%Apps').filterMode, 'database');
  assert.equal(parseUniversalSearchQuery('#IUserService').filterMode, 'types');
  assert.equal(parseUniversalSearchQuery('@Validate').filterMode, 'methods');
  assert.equal(parseUniversalSearchQuery('!appsettings').filterMode, 'files');
  assert.equal(parseUniversalSearchQuery('normal search').filterMode, 'all');
});

test('isCamelCaseAcronymMatch matches acronyms like CIVC -> CreateInterfaceViewCommand', () => {
  assert.equal(isCamelCaseAcronymMatch('CIVC', 'CreateInterfaceViewCommand'), true);
  assert.equal(isCamelCaseAcronymMatch('civc', 'CreateInterfaceViewCommand'), true);
  assert.equal(isCamelCaseAcronymMatch('CIV', 'CreateInterfaceViewCommand'), true);
  assert.equal(isCamelCaseAcronymMatch('ABC', 'CreateInterfaceViewCommand'), false);
});

test('searchUniversalSymbols ranks exact matches and acronyms correctly', () => {
  // 1. Acronym match CIVC
  const results1 = searchUniversalSymbols(sampleSymbols, 'CIVC');
  assert.ok(results1.length >= 1);
  assert.equal(results1[0].symbol.name, 'CreateInterfaceViewCommand');
  assert.ok(results1[0].score >= 90);

  // 2. Prefix CQRS search
  const results2 = searchUniversalSymbols(sampleSymbols, '$InterfaceView');
  assert.equal(results2.length, 2); // Command and Handler only
  assert.equal(results2[0].symbol.kind.startsWith('cqrs_'), true);

  // 3. Multi-gap endpoint search
  const results3 = searchUniversalSymbols(sampleSymbols, 'apps//fields//validation');
  assert.ok(results3.length >= 1);
  assert.equal(results3[0].symbol.kind, 'endpoint');

  // 4. Database prefix search
  const results4 = searchUniversalSymbols(sampleSymbols, '%Apps');
  assert.equal(results4.length, 1);
  assert.equal(results4[0].symbol.kind, 'ef_dbset');
});

test('parseUniversalSearchQuery parses line jump and column syntax', () => {
  const q1 = parseUniversalSearchQuery('SubmitFormService:762');
  assert.equal(q1.cleanQuery, 'SubmitFormService');
  assert.equal(q1.targetLine, 762);
  assert.equal(q1.targetColumn, 1);

  const q2 = parseUniversalSearchQuery('SubmitFormService:762:15');
  assert.equal(q2.cleanQuery, 'SubmitFormService');
  assert.equal(q2.targetLine, 762);
  assert.equal(q2.targetColumn, 15);

  const q3 = parseUniversalSearchQuery('@ValidateField@45');
  assert.equal(q3.filterMode, 'methods');
  assert.equal(q3.cleanQuery, 'ValidateField');
  assert.equal(q3.targetLine, 45);
});

test('searchUniversalSymbols applies active project and MRU affinity boost', () => {
  // Without context
  const resNoContext = searchUniversalSymbols(sampleSymbols, 'InterfaceView');
  const topNoContext = resNoContext[0].symbol.projectName;

  // With active project affinity for Cleeksy.Interface
  const resProjectAffinity = searchUniversalSymbols(sampleSymbols, 'InterfaceView', 10, {
    activeProjectName: 'Cleeksy.Interface'
  });
  assert.equal(resProjectAffinity[0].symbol.projectName, 'Cleeksy.Interface');
  assert.ok(resProjectAffinity[0].matchReason.includes('Active Project'));

  // With MRU boost
  const resMRU = searchUniversalSymbols(sampleSymbols, 'InterfaceView', 10, {
    mruSymbolIds: ['3'] // CreateInterfaceViewCommandHandler
  });
  assert.equal(resMRU[0].symbol.id, '3');
  assert.ok(resMRU[0].matchReason.includes('Recent'));
});

test('searchUniversalSymbols ranks method search like GetFormElementByReferenceIdsAsync above endpoints ending in /{id}', () => {
  const symbolsWithEndpoints: UniversalSymbol[] = [
    {
      id: 'ep-template',
      name: 'GET /api/cms/app-templates/{id}',
      kind: 'endpoint',
      filePath: '/src/TemplateLibraryController.cs',
      relativePath: 'TemplateLibraryController.cs',
      projectName: 'Cleeksy.SolutionCanvas',
      line: 117,
      column: 1,
      metadata: { httpMethod: 'GET', routeTemplate: 'cms/app-templates/{id}' }
    },
    {
      id: 'ep-account',
      name: 'GET /api/cms/accounts/{id}',
      kind: 'endpoint',
      filePath: '/src/AccountController.cs',
      relativePath: 'AccountController.cs',
      projectName: 'Cleeksy.SolutionCanvas',
      line: 49,
      column: 1,
      metadata: { httpMethod: 'GET', routeTemplate: 'cms/accounts/{id}' }
    },
    {
      id: 'ep-attachment',
      name: 'GET /api/BaseAttachment/{fileId}',
      kind: 'endpoint',
      filePath: '/src/BaseAttachmentController.cs',
      relativePath: 'BaseAttachmentController.cs',
      projectName: 'ELDesk.Shared.Service',
      line: 22,
      column: 1,
      metadata: { httpMethod: 'GET', routeTemplate: 'api/BaseAttachment/{fileId}' }
    },
    {
      id: 'method-target',
      name: 'GetFormElementByReferenceIdsAsync(...)',
      kind: 'method',
      filePath: '/src/FormService.Get.cs',
      relativePath: 'FormService.Get.cs',
      projectName: 'ELDesk.CustomApp',
      line: 268,
      column: 1,
      metadata: {
        returnType: 'Task<List<GetFieldInfo>>',
        parameterSummary: 'GetFormElementByReferenceIdsRequest request, CancellationToken cancellationToken'
      }
    }
  ];

  const results = searchUniversalSymbols(symbolsWithEndpoints, 'GetFormElementByReferenceIdsAsync');
  assert.ok(results.length >= 1);
  assert.equal(results[0].symbol.id, 'method-target');
  assert.equal(results[0].score, 100);

  // Ensure fake placeholder endpoints did not match
  const matchedEndpointIds = results.filter(r => r.symbol.kind === 'endpoint').map(r => r.symbol.id);
  assert.equal(matchedEndpointIds.length, 0);
});

test('searchUniversalSymbols ranks gap route queries like project-views//record-fields accurately', () => {
  const routeSymbols: UniversalSymbol[] = [
    {
      id: 'ep-unrelated-view',
      name: 'PUT /api/custom-app/project-views/{viewId}',
      kind: 'endpoint',
      filePath: '/src/ViewController.cs',
      relativePath: 'ViewController.cs',
      projectName: 'ELDesk.CustomApp',
      line: 77,
      column: 1,
      metadata: { httpMethod: 'PUT', routeTemplate: 'custom-app/project-views/{viewId}' }
    },
    {
      id: 'ep-column-size',
      name: 'GET /api/Project/{projectId}/project-views/{viewId}/column-size',
      kind: 'endpoint',
      filePath: '/src/ProjectController.UserPreference.cs',
      relativePath: 'ProjectController.UserPreference.cs',
      projectName: 'ELDesk.Work',
      line: 23,
      column: 1,
      metadata: { httpMethod: 'GET', routeTemplate: 'api/Project/{projectId}/project-views/{viewId}/column-size' }
    },
    {
      id: 'ep-target-get',
      name: 'GET /work/projects/{projectId}/project-views/{viewId}/record-fields',
      kind: 'endpoint',
      filePath: '/src/ProjectController.ProjectView.cs',
      relativePath: 'ProjectController.ProjectView.cs',
      projectName: 'ELDesk.Work',
      line: 120,
      column: 1,
      metadata: { httpMethod: 'GET', routeTemplate: '{projectId}/project-views/{viewId}/record-fields' }
    },
    {
      id: 'ep-target-put',
      name: 'PUT /work/projects/{projectId}/project-views/record-fields',
      kind: 'endpoint',
      filePath: '/src/ProjectController.ProjectView.cs',
      relativePath: 'ProjectController.ProjectView.cs',
      projectName: 'ELDesk.Work',
      line: 145,
      column: 1,
      metadata: { httpMethod: 'PUT', routeTemplate: '{projectId}/project-views/record-fields' }
    }
  ];

  const results = searchUniversalSymbols(routeSymbols, 'project-views//record-fields');
  assert.ok(results.length >= 2);
  const resultIds = results.map(r => r.symbol.id);
  assert.ok(resultIds.includes('ep-target-get'));
  assert.ok(resultIds.includes('ep-target-put'));

  // Ensure endpoints without record-fields are not returned or not ranked above targets
  assert.equal(resultIds.includes('ep-unrelated-view'), false);
  assert.equal(resultIds.includes('ep-column-size'), false);
});

