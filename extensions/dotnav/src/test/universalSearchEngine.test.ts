import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeRouteTemplate,
  parseUniversalSearchQuery,
  scoreSymbol,
  searchUniversalSymbols
} from '../solutionSearch/searchEngine';
import { UniversalSymbol } from '../solutionSearch/searchModel';
import {
  parseSymbolsFromCSharp,
  parseSymbolsFromResx,
  UniversalSymbolIndex
} from '../solutionSearch/searchScanner';

test('normalizeRouteTemplate strips constraints and optional api prefix', () => {
  assert.equal(
    normalizeRouteTemplate('/api/custom-app/apps/{appId:int}/fields/view-fields'),
    'custom-app/apps/{appid}/fields/view-fields'
  );
  assert.equal(
    normalizeRouteTemplate('api/users/{userId:guid}/orders/{orderId:long}'),
    'users/{userid}/orders/{orderid}'
  );
  assert.equal(
    normalizeRouteTemplate('/api/v1/documents/{id:regex(^\\d+$)}'),
    'v1/documents/{id}'
  );
});

test('scoreSymbol ranks exact route template match (with constraints) higher than noisy sub-routes', () => {
  const result1Noisy: UniversalSymbol = {
    id: 'noisy-endpoint',
    name: 'GetConnectionViewFields',
    kind: 'endpoint',
    projectName: 'ELDesk.CustomApp',
    filePath: '/src/DataSourceController.cs',
    relativePath: 'API/DataSourceController.cs',
    line: 428,
    column: 1,
    metadata: {
      httpMethod: 'GET',
      routeTemplate: '/api/custom-app/apps/{appId:int}/data-sources/api/fields/{fieldId:int}/connection-view-fields',
      controllerName: 'DataSourceController',
      actionName: 'GetConnectionViewFields'
    }
  };

  const result2Exact: UniversalSymbol = {
    id: 'exact-endpoint',
    name: 'GetViewFields',
    kind: 'endpoint',
    projectName: 'ELDesk.CustomApp',
    filePath: '/src/FieldManagementController.cs',
    relativePath: 'API/FieldManagementController.cs',
    line: 185,
    column: 1,
    metadata: {
      httpMethod: 'GET',
      routeTemplate: '/api/custom-app/apps/{appId:int}/fields/view-fields',
      controllerName: 'FieldManagementController',
      actionName: 'GetViewFields'
    }
  };

  const query = parseUniversalSearchQuery('custom-app/apps/{appId}/fields/view-fields');

  const scoreExact = scoreSymbol(result2Exact, query);
  const scoreNoisy = scoreSymbol(result1Noisy, query);

  assert.equal(scoreExact.score >= 98, true, `Exact match score (${scoreExact.score}) should be >= 98`);
  assert.equal(scoreExact.score > scoreNoisy.score, true, `Exact match score (${scoreExact.score}) should be strictly greater than noisy score (${scoreNoisy.score})`);
  assert.equal(scoreExact.matchReason.includes('route template match') || scoreExact.matchReason.includes('Exact'), true);
});

test('scoreSymbol penalizes long noisy symbol names when searching specific short terms', () => {
  const shortSym: UniversalSymbol = {
    id: '1',
    name: 'AppField',
    kind: 'class',
    projectName: 'ELDesk.Domain',
    filePath: '/src/AppField.cs',
    relativePath: 'Entities/AppField.cs',
    line: 10,
    column: 1
  };

  const longNoisySym: UniversalSymbol = {
    id: '2',
    name: 'DbConnectionFieldDataResponseWithAppFieldExtensionsHelper',
    kind: 'class',
    projectName: 'ELDesk.Domain',
    filePath: '/src/Helper.cs',
    relativePath: 'Entities/Helper.cs',
    line: 10,
    column: 1
  };

  const query = parseUniversalSearchQuery('AppField');

  const scoreShort = scoreSymbol(shortSym, query);
  const scoreLong = scoreSymbol(longNoisySym, query);

  assert.equal(scoreShort.score > scoreLong.score, true);
  assert.equal(scoreShort.score, 100);
});

test('scoreSymbol matches dynamic parameter values (numbers, GUIDs) and ranks endpoint #1 over domain events', () => {
  const endpoint: UniversalSymbol = {
    id: 'form-mode-endpoint',
    name: 'PUT /api/custom-app/apps/forms/{formId}/mode',
    kind: 'endpoint',
    projectName: 'ELDesk.CustomApp',
    filePath: '/src/API/FormController.cs',
    relativePath: 'API/FormController.cs',
    line: 177,
    column: 1,
    metadata: {
      httpMethod: 'PUT',
      routeTemplate: '/api/custom-app/apps/forms/{formId}/mode',
      controllerName: 'FormController',
      actionName: 'UpdateFormMode'
    }
  };

  const competingDomainEvent: UniversalSymbol = {
    id: 'form-mode-event',
    name: 'FormModeSwitchedDomainEvent',
    kind: 'cqrs_event',
    projectName: 'ELDesk.CustomApp.SharedDomain',
    filePath: '/src/Entities/FormModeSwitchedDomainEvent.cs',
    relativePath: 'Entities/FormModeSwitchedDomainEvent.cs',
    line: 12,
    column: 1
  };

  const competingModel: UniversalSymbol = {
    id: 'form-submission-model',
    name: 'FormSubmissionTextValueChangeModel',
    kind: 'class',
    projectName: 'ELDesk.CustomApp',
    filePath: '/src/Models/FormSubmissionTextValueChangeModel.cs',
    relativePath: 'Models/FormSubmissionTextValueChangeModel.cs',
    line: 5,
    column: 1
  };

  // 1. Without leading slash: apps/forms/66090/mode
  const queryNoSlash = parseUniversalSearchQuery('apps/forms/66090/mode');
  assert.equal(queryNoSlash.isRouteQuery, true);

  const scoreEndpoint = scoreSymbol(endpoint, queryNoSlash, { activeProjectName: 'ELDesk.CustomApp' });
  const scoreEvent = scoreSymbol(competingDomainEvent, queryNoSlash, { activeProjectName: 'ELDesk.CustomApp' });
  const scoreModel = scoreSymbol(competingModel, queryNoSlash, { activeProjectName: 'ELDesk.CustomApp' });

  assert.equal(scoreEndpoint.score >= 98, true, `Endpoint score (${scoreEndpoint.score}) must be >= 98`);
  assert.equal(scoreEndpoint.score > scoreEvent.score, true, `Endpoint (${scoreEndpoint.score}) must beat DomainEvent (${scoreEvent.score})`);
  assert.equal(scoreEndpoint.score > scoreModel.score, true, `Endpoint (${scoreEndpoint.score}) must beat Model (${scoreModel.score})`);

  // 2. Full URL from Swagger: http://localhost:5000/api/custom-app/apps/forms/66090/mode?expand=true#details
  const querySwagger = parseUniversalSearchQuery('http://localhost:5000/api/custom-app/apps/forms/66090/mode?expand=true#details');
  assert.equal(querySwagger.cleanQuery, 'api/custom-app/apps/forms/66090/mode');
  const scoreSwagger = scoreSymbol(endpoint, querySwagger);
  assert.equal(scoreSwagger.score, 100);

  // 3. With explicit HTTP method: PUT apps/forms/66090/mode
  const queryPut = parseUniversalSearchQuery('PUT apps/forms/66090/mode');
  assert.equal(queryPut.explicitHttpMethod, 'PUT');
  const scorePut = scoreSymbol(endpoint, queryPut);
  assert.equal(scorePut.score >= 99, true);

  // 4. GUID parameter matching: users/e0d4a940-1234-4a55-a22b-b8a914c62d08/roles
  const guidEndpoint: UniversalSymbol = {
    id: 'user-roles-endpoint',
    name: 'GET /api/users/{userId:guid}/roles',
    kind: 'endpoint',
    projectName: 'ELDesk.IAM',
    filePath: '/src/UserController.cs',
    relativePath: 'UserController.cs',
    line: 50,
    column: 1,
    metadata: {
      httpMethod: 'GET',
      routeTemplate: '/api/users/{userId:guid}/roles',
      controllerName: 'UserController'
    }
  };
  const queryGuid = parseUniversalSearchQuery('users/e0d4a940-1234-4a55-a22b-b8a914c62d08/roles');
  const scoreGuid = scoreSymbol(guidEndpoint, queryGuid);
  assert.equal(scoreGuid.score >= 98, true, `GUID route match score (${scoreGuid.score}) must be >= 98`);
});

test('scoreSymbol applies C# Naming Intent Detection (Interface vs Class vs CQRS)', () => {
  const ifaceSym: UniversalSymbol = {
    id: 'iface-1',
    name: 'IAppFieldRepository',
    kind: 'interface',
    projectName: 'ELDesk.Domain',
    filePath: '/src/IAppFieldRepository.cs',
    relativePath: 'Repositories/IAppFieldRepository.cs',
    line: 10,
    column: 1
  };

  const classSym: UniversalSymbol = {
    id: 'class-1',
    name: 'AppFieldRepository',
    kind: 'class',
    projectName: 'ELDesk.Infrastructure',
    filePath: '/src/AppFieldRepository.cs',
    relativePath: 'Repositories/AppFieldRepository.cs',
    line: 10,
    column: 1
  };

  // When searching "IAppFieldRepository", the interface must rank higher than the implementation class
  const queryIface = parseUniversalSearchQuery('IAppFieldRepository');
  const scoreIface = scoreSymbol(ifaceSym, queryIface);
  const scoreClass = scoreSymbol(classSym, queryIface);

  assert.equal(scoreIface.score > scoreClass.score, true);
  assert.equal(scoreIface.matchReason.includes('Interface'), true);

  // When searching "CreateFormCommand", CQRS command should receive CQRS boost
  const commandSym: UniversalSymbol = {
    id: 'cmd-1',
    name: 'CreateFormCommand',
    kind: 'cqrs_command',
    projectName: 'ELDesk.CustomApp',
    filePath: '/src/Commands/CreateFormCommand.cs',
    relativePath: 'Commands/CreateFormCommand.cs',
    line: 5,
    column: 1
  };
  const queryCmd = parseUniversalSearchQuery('CreateFormCommand');
  const scoreCmd = scoreSymbol(commandSym, queryCmd);
  assert.equal(scoreCmd.score, 100);
  assert.equal(scoreCmd.matchReason.includes('CQRS') || scoreCmd.matchReason.includes('Exact'), true);
});

test('scoreSymbol applies Git Working Tree Gravity and Editor Context Gravity', () => {
  const normalSym: UniversalSymbol = {
    id: 'sym-1',
    name: 'FormValidator',
    kind: 'class',
    projectName: 'ELDesk.CustomApp',
    filePath: '/src/Validation/FormValidator.cs',
    relativePath: 'Validation/FormValidator.cs',
    line: 10,
    column: 1
  };

  const gitModifiedSym: UniversalSymbol = {
    id: 'sym-2',
    name: 'FormValidator',
    kind: 'class',
    projectName: 'ELDesk.CustomApp',
    filePath: '/src/Validation/FormValidator.cs',
    relativePath: 'Validation/FormValidator.cs',
    line: 10,
    column: 1
  };

  const query = parseUniversalSearchQuery('FormValidator');

  // Without git modified
  const scoreNormal = scoreSymbol(normalSym, query);

  // With git modified
  const scoreGit = scoreSymbol(gitModifiedSym, query, {
    gitModifiedPaths: ['Validation/FormValidator.cs'],
    activeNoun: 'Form'
  });

  assert.equal(scoreGit.score >= scoreNormal.score, true);
  assert.equal(scoreGit.matchReason.includes('Git Modified'), true);
});

test('parseSymbolsFromCSharp extracts error messages, responses, and FluentValidation rules', () => {
  const sampleCode = `
namespace ELDesk.CustomApp.Services;

public class FormService
{
    public void Validate(Form form)
    {
        if (form == null)
            throw new BusinessException("Form not found or has been deleted");

        if (form.Id <= 0)
            return BadRequest("Invalid form schema definition");
    }
}

public class FormValidator : AbstractValidator<Form>
{
    public FormValidator()
    {
        RuleFor(x => x.Title).NotEmpty().WithMessage("Title is required and must not be empty");
    }
}
`;

  const symbols = parseSymbolsFromCSharp(sampleCode, '/src/FormService.cs', 'ELDesk.CustomApp', 'Services/FormService.cs');
  
  const exMsg = symbols.find(s => s.kind === 'error_message' && s.name.includes('Form not found or has been deleted'));
  assert.equal(exMsg !== undefined, true, 'Must find BusinessException error message');
  assert.equal(exMsg?.metadata?.baseType, 'BusinessException');

  const badReqMsg = symbols.find(s => s.kind === 'error_message' && s.name.includes('Invalid form schema definition'));
  assert.equal(badReqMsg !== undefined, true, 'Must find BadRequest response error message');

  const fluentMsg = symbols.find(s => s.kind === 'error_message' && s.name.includes('Title is required'));
  assert.equal(fluentMsg !== undefined, true, 'Must find FluentValidation message');
});

test('parseSymbolsFromResx extracts localization resources with localization_resource kind', () => {
  const resxContent = `<?xml version="1.0" encoding="utf-8"?>
<root>
  <data name="UserNotFound" xml:space="preserve">
    <value>User with specified ID does not exist</value>
  </data>
</root>`;

  const symbols = parseSymbolsFromResx(resxContent, '/src/Resources.resx', 'ELDesk.Domain', 'Resources.resx');
  assert.equal(symbols.length, 1);
  assert.equal(symbols[0].kind, 'localization_resource');
  assert.equal(symbols[0].name.includes('UserNotFound'), true);
  assert.equal(symbols[0].metadata?.configValue, 'User with specified ID does not exist');
});

test('searchUniversalSymbols finds error messages and localization by message content', () => {
  const exMsg: UniversalSymbol = {
    id: 'err-1',
    name: '"Form not found or has been deleted"',
    kind: 'error_message',
    projectName: 'ELDesk.CustomApp',
    filePath: '/src/FormService.cs',
    relativePath: 'Services/FormService.cs',
    line: 12,
    column: 1,
    metadata: {
      configValue: 'Form not found or has been deleted',
      baseType: 'BusinessException'
    }
  };

  const index = new UniversalSymbolIndex();
  index.scanFileContent(
    '/src/FormService.cs',
    'throw new BusinessException("Form not found or has been deleted");',
    'ELDesk.CustomApp',
    'Services/FormService.cs'
  );

  const results = searchUniversalSymbols(index, 'Form not found', 10);
  assert.equal(results.length > 0, true, 'Must find error message when searching "Form not found"');
  assert.equal(results[0].symbol.kind, 'error_message');
  assert.equal(results[0].symbol.name.includes('Form not found'), true);
});


