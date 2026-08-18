import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  combineRoutes,
  normalizeRouteTemplate,
  parseEndpointsFromCSharp,
  resolveRouteTokens
} from '../endpoints/endpointScanner';

test('normalizeRouteTemplate strips leading slashes, duplicates, and parameter constraints', () => {
  assert.equal(
    normalizeRouteTemplate('///api/users/{id:guid}/details'),
    'api/users/{id}/details'
  );
  assert.equal(
    normalizeRouteTemplate('interface-views/{interfaceViewId:int}/filter-fields'),
    'interface-views/{interfaceViewId}/filter-fields'
  );
  assert.equal(
    normalizeRouteTemplate('orders/{orderId:long?}/items/{itemId:int=1}'),
    'orders/{orderId}/items/{itemId}'
  );
});

test('combineRoutes correctly joins class and action routes and respects absolute root overrides', () => {
  assert.equal(combineRoutes('api/[controller]', 'filter-fields'), 'api/[controller]/filter-fields');
  assert.equal(combineRoutes('api/v1', '/custom/absolute/route'), 'custom/absolute/route');
  assert.equal(combineRoutes('api/v1', '~/custom/absolute/route'), 'custom/absolute/route');
  assert.equal(combineRoutes(undefined, 'users/{id}'), 'users/{id}');
  assert.equal(combineRoutes('api/users', undefined), 'api/users');
});

test('resolveRouteTokens replaces [controller] and [action]', () => {
  assert.equal(
    resolveRouteTokens('api/[controller]/[action]', 'InterfaceViewsController', 'GetFilterFields'),
    'api/InterfaceViews/GetFilterFields'
  );
  assert.equal(
    resolveRouteTokens('api/[area]/[controller]', 'OrdersController', 'GetOrders', 'Admin'),
    'api/Admin/Orders'
  );
});

test('parseEndpointsFromCSharp parses controller with complex route templates and methods', () => {
  const csharpCode = `
using Microsoft.AspNetCore.Mvc;

namespace MyApi.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class InterfaceViewsController : ControllerBase
    {
        [HttpGet("interface-views/{interfaceViewId:int}/filter-fields")]
        public async Task<ActionResult<List<string>>> GetFilterFields(int interfaceViewId)
        {
            return Ok();
        }

        [HttpPost("{interfaceViewId:int}/update")]
        public IActionResult UpdateFields(int interfaceViewId, [FromBody] object payload)
        {
            return Ok();
        }

        [HttpDelete("/api/raw-delete/{id}")]
        public IActionResult DeleteRaw(int id)
        {
            return NoContent();
        }
    }
}
`;

  const endpoints = parseEndpointsFromCSharp(
    csharpCode,
    '/src/Controllers/InterfaceViewsController.cs',
    'MyApi',
    'Controllers/InterfaceViewsController.cs'
  );

  assert.equal(endpoints.length, 3);

  // 1st endpoint: GetFilterFields
  const ep1 = endpoints[0];
  assert.equal(ep1.httpMethod, 'GET');
  assert.equal(ep1.controllerName, 'InterfaceViewsController');
  assert.equal(ep1.actionName, 'GetFilterFields');
  assert.equal(ep1.routeTemplate, 'api/InterfaceViews/interface-views/{interfaceViewId:int}/filter-fields');
  assert.equal(ep1.normalizedRoute, 'api/InterfaceViews/interface-views/{interfaceViewId}/filter-fields');
  assert.equal(ep1.kind, 'controller');

  // 2nd endpoint: UpdateFields
  const ep2 = endpoints[1];
  assert.equal(ep2.httpMethod, 'POST');
  assert.equal(ep2.actionName, 'UpdateFields');
  assert.equal(ep2.routeTemplate, 'api/InterfaceViews/{interfaceViewId:int}/update');

  // 3rd endpoint: Absolute route override
  const ep3 = endpoints[2];
  assert.equal(ep3.httpMethod, 'DELETE');
  assert.equal(ep3.routeTemplate, 'api/raw-delete/{id}');
});

test('parseEndpointsFromCSharp parses ASP.NET Core Minimal APIs', () => {
  const csharpCode = `
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/api/todos", () => "all todos");
app.MapPost("/api/todos/{id:guid}", (Guid id) => id);
app.MapDelete("/api/todos/{id}", (int id) => Results.NoContent());

app.Run();
`;

  const endpoints = parseEndpointsFromCSharp(
    csharpCode,
    '/src/Program.cs',
    'TodoApp',
    'Program.cs'
  );

  assert.equal(endpoints.length, 3);
  assert.equal(endpoints[0].httpMethod, 'GET');
  assert.equal(endpoints[0].routeTemplate, '/api/todos');
  assert.equal(endpoints[0].kind, 'minimalApi');

  assert.equal(endpoints[1].httpMethod, 'POST');
  assert.equal(endpoints[1].routeTemplate, '/api/todos/{id:guid}');

  assert.equal(endpoints[2].httpMethod, 'DELETE');
  assert.equal(endpoints[2].routeTemplate, '/api/todos/{id}');
});

test('parseEndpointsFromCSharp parses controller route with api/fields and {fieldId:int}/validation', () => {
  const csharpCode = `
namespace MyApp.Controllers
{
    [ApiController]
    [Route("api/fields")]
    public class FieldsController : ControllerBase
    {
        [HttpGet("{fieldId:int}/validation")]
        public IActionResult ValidateField(int fieldId)
        {
            return Ok();
        }
    }
}
`;

  const endpoints = parseEndpointsFromCSharp(
    csharpCode,
    '/src/Controllers/FieldsController.cs',
    'MyApp',
    'Controllers/FieldsController.cs'
  );

  assert.equal(endpoints.length, 1);
  assert.equal(endpoints[0].httpMethod, 'GET');
  assert.equal(endpoints[0].routeTemplate, 'api/fields/{fieldId:int}/validation');
  assert.equal(endpoints[0].normalizedRoute, 'api/fields/{fieldId}/validation');
  assert.equal(endpoints[0].actionName, 'ValidateField');
});
