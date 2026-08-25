import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeRouteTemplate,
  parseUniversalSearchQuery,
  scoreSymbol
} from '../solutionSearch/searchEngine';
import { UniversalSymbol } from '../solutionSearch/searchModel';

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

