import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiEndpoint } from '../endpoints/endpointModel';
import { parseSearchQuery, searchEndpoints } from '../endpoints/endpointSearch';

const mockEndpoints: ApiEndpoint[] = [
  {
    id: '1',
    httpMethod: 'GET',
    routeTemplate: 'interface-views/{interfaceViewId:int}/filter-fields',
    normalizedRoute: 'interface-views/{interfaceViewId}/filter-fields',
    controllerName: 'InterfaceViewsController',
    actionName: 'GetFilterFields',
    kind: 'controller',
    filePath: '/src/InterfaceViewsController.cs',
    relativePath: 'Controllers/InterfaceViewsController.cs',
    line: 42,
    projectName: 'WebApp.Api'
  },
  {
    id: '2',
    httpMethod: 'POST',
    routeTemplate: 'interface-views/{interfaceViewId:int}/filter-fields',
    normalizedRoute: 'interface-views/{interfaceViewId}/filter-fields',
    controllerName: 'InterfaceViewsController',
    actionName: 'CreateFilterField',
    kind: 'controller',
    filePath: '/src/InterfaceViewsController.cs',
    relativePath: 'Controllers/InterfaceViewsController.cs',
    line: 60,
    projectName: 'WebApp.Api'
  },
  {
    id: '3',
    httpMethod: 'GET',
    routeTemplate: 'api/users/{userId:guid}/orders/{orderId:int}',
    normalizedRoute: 'api/users/{userId}/orders/{orderId}',
    controllerName: 'UsersController',
    actionName: 'GetUserOrder',
    kind: 'controller',
    filePath: '/src/UsersController.cs',
    relativePath: 'Controllers/UsersController.cs',
    line: 25,
    projectName: 'WebApp.Api'
  },
  {
    id: '4',
    httpMethod: 'DELETE',
    routeTemplate: 'api/users/{id}',
    normalizedRoute: 'api/users/{id}',
    controllerName: 'UsersController',
    actionName: 'DeleteUser',
    kind: 'controller',
    filePath: '/src/UsersController.cs',
    relativePath: 'Controllers/UsersController.cs',
    line: 80,
    projectName: 'WebApp.Api'
  }
];

test('parseSearchQuery extracts explicit HTTP methods and tokenizes route paths', () => {
  const q1 = parseSearchQuery('GET interface-views//filter-fields');
  assert.equal(q1.desiredMethod, 'GET');
  assert.equal(q1.routeQuery, 'interface-views//filter-fields');
  assert.deepEqual(q1.tokens, ['interface-views', 'filter-fields']);

  const q2 = parseSearchQuery('users/orders POST');
  assert.equal(q2.desiredMethod, 'POST');
  assert.deepEqual(q2.tokens, ['users', 'orders']);

  const q3 = parseSearchQuery('interface-views//filter-fields');
  assert.equal(q3.desiredMethod, undefined);
  assert.deepEqual(q3.tokens, ['interface-views', 'filter-fields']);
});

test('searchEndpoints matches interface-views//filter-fields with parameter wildcards', () => {
  const results = searchEndpoints(mockEndpoints, 'interface-views//filter-fields');

  assert.ok(results.length >= 2);
  // Top result should be the interface-views filter-fields endpoint
  assert.equal(results[0].endpoint.routeTemplate, 'interface-views/{interfaceViewId:int}/filter-fields');
  assert.ok(results[0].score >= 85);
});

test('searchEndpoints matches interface-views/filter-fields without double slashes', () => {
  const results = searchEndpoints(mockEndpoints, 'interface-views/filter-fields');

  assert.ok(results.length >= 2);
  assert.equal(results[0].endpoint.routeTemplate, 'interface-views/{interfaceViewId:int}/filter-fields');
});

test('searchEndpoints prioritizes explicit HTTP method in query', () => {
  const getResults = searchEndpoints(mockEndpoints, 'GET interface-views//filter-fields');
  assert.equal(getResults[0].endpoint.httpMethod, 'GET');
  assert.equal(getResults[0].endpoint.actionName, 'GetFilterFields');

  const postResults = searchEndpoints(mockEndpoints, 'POST interface-views//filter-fields');
  assert.equal(postResults[0].endpoint.httpMethod, 'POST');
  assert.equal(postResults[0].endpoint.actionName, 'CreateFilterField');
});

test('searchEndpoints matches users//orders for deep parameter routes', () => {
  const results = searchEndpoints(mockEndpoints, 'users//orders');
  assert.ok(results.length > 0);
  assert.equal(results[0].endpoint.routeTemplate, 'api/users/{userId:guid}/orders/{orderId:int}');
});

test('searchEndpoints matches by controller and action names', () => {
  const results1 = searchEndpoints(mockEndpoints, 'GetFilterFields');
  assert.equal(results1[0].endpoint.actionName, 'GetFilterFields');

  const results2 = searchEndpoints(mockEndpoints, 'UsersController');
  assert.ok(results2.length >= 2);
  assert.equal(results2[0].endpoint.controllerName, 'UsersController');
});
