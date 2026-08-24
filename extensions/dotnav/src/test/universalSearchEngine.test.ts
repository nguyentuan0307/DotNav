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
