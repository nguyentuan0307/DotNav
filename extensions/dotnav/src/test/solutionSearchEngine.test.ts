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

