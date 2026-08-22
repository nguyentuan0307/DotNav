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
  assert.equal(endpoints[0].routeTemplate, 'api/todos');
  assert.equal(endpoints[0].kind, 'minimalApi');

  assert.equal(endpoints[1].httpMethod, 'POST');
  assert.equal(endpoints[1].routeTemplate, 'api/todos/{id:guid}');

  assert.equal(endpoints[2].httpMethod, 'DELETE');
  assert.equal(endpoints[2].routeTemplate, 'api/todos/{id}');
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
  assert.equal(endpoints[0].segments.length, 4);
  assert.equal(endpoints[0].segments[2].isParam, true);
  assert.equal(endpoints[0].segments[2].paramName, 'fieldId');
  assert.equal(endpoints[0].segments[2].constraint, 'int');
});

test('parseEndpointsFromCSharp parses chained MapGroup Minimal APIs', () => {
  const csharpCode = `
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

var api = app.MapGroup("/api/v1");
api.MapGet("/users", () => "users");
api.MapPost("/users/{id:guid}/activate", (Guid id) => "activated");

app.Run();
`;

  const endpoints = parseEndpointsFromCSharp(
    csharpCode,
    '/src/Program.cs',
    'ApiApp',
    'Program.cs'
  );

  assert.equal(endpoints.length, 2);
  assert.equal(endpoints[0].routeTemplate, 'api/v1/users');
  assert.equal(endpoints[0].httpMethod, 'GET');

  assert.equal(endpoints[1].routeTemplate, 'api/v1/users/{id:guid}/activate');
  assert.equal(endpoints[1].httpMethod, 'POST');
  assert.equal(endpoints[1].routeParameters?.[0].name, 'id');
  assert.equal(endpoints[1].routeParameters?.[0].typeConstraint, 'guid');
});

test('parseEndpointsFromCSharp parses multiple Route attributes on controller', () => {
  const csharpCode = `
namespace MyApp.Controllers
{
    [ApiController]
    [Route("api/v1/[controller]")]
    [Route("api/v2/[controller]")]
    public class OrdersController : ControllerBase
    {
        [HttpGet("{id:int}")]
        public IActionResult GetOrder(int id) => Ok();
    }
}
`;

  const endpoints = parseEndpointsFromCSharp(
    csharpCode,
    '/src/Controllers/OrdersController.cs',
    'MyApp',
    'Controllers/OrdersController.cs'
  );

  assert.equal(endpoints.length, 2);
  assert.equal(endpoints[0].routeTemplate, 'api/v1/Orders/{id:int}');
  assert.equal(endpoints[1].routeTemplate, 'api/v2/Orders/{id:int}');
});

test('isIgnoredEndpointFile detects bin, obj, generated, and designer files', () => {
  const { isIgnoredEndpointFile } = require('../endpoints/endpointScanner');
  assert.equal(isIgnoredEndpointFile('/repo/src/MyProject/obj/Debug/net8.0/MyProject.AssemblyInfo.cs'), true);
  assert.equal(isIgnoredEndpointFile('C:\\repo\\src\\bin\\Release\\net8.0\\App.g.cs'), true);
  assert.equal(isIgnoredEndpointFile('/repo/src/Controllers/MyView.Designer.cs'), true);
  assert.equal(isIgnoredEndpointFile('/repo/src/Controllers/User.generated.cs'), true);
  assert.equal(isIgnoredEndpointFile('/repo/.git/HEAD'), true);
  assert.equal(isIgnoredEndpointFile('/repo/node_modules/pkg/index.cs'), true);
  assert.equal(isIgnoredEndpointFile('/repo/src/Controllers/UsersController.cs'), false);
  assert.equal(isIgnoredEndpointFile('/repo/src/Endpoints/TodoEndpoints.cs'), false);
});

test('EndpointIndex supports incremental updates, file modifications, and invalidations', () => {
  const { EndpointIndex } = require('../endpoints/endpointScanner');
  const index = new EndpointIndex();

  const code1 = `
[ApiController]
[Route("api/users")]
public class UsersController : ControllerBase {
    [HttpGet]
    public IActionResult GetAll() => Ok();
}
`;
  const code2 = `
[ApiController]
[Route("api/orders")]
public class OrdersController : ControllerBase {
    [HttpGet("{id:int}")]
    public IActionResult GetById(int id) => Ok();
}
`;

  // 1. Initial scan
  index.scanFileContent('/src/UsersController.cs', code1, 'MyProject', 'UsersController.cs');
  index.scanFileContent('/src/OrdersController.cs', code2, 'MyProject', 'OrdersController.cs');
  assert.equal(index.count, 2);
  assert.equal(index.fileCount, 2);
  assert.equal(index.hasFile('/src/UsersController.cs'), true);

  // 2. Incremental modification of a file (add an endpoint)
  const code1Updated = `
[ApiController]
[Route("api/users")]
public class UsersController : ControllerBase {
    [HttpGet]
    public IActionResult GetAll() => Ok();
    [HttpPost]
    public IActionResult Create() => Ok();
}
`;
  index.scanFileContent('/src/UsersController.cs', code1Updated, 'MyProject', 'UsersController.cs');
  assert.equal(index.count, 3); // 2 in Users + 1 in Orders
  assert.equal(index.fileCount, 2);

  // 3. Invalidate single file (e.g. on delete or move)
  index.invalidateFile('/src/UsersController.cs');
  assert.equal(index.count, 1);
  assert.equal(index.fileCount, 1);
  assert.equal(index.hasFile('/src/UsersController.cs'), false);
  assert.equal(index.getAllEndpoints()[0].controllerName, 'OrdersController');

  // 4. Clear on mass checkout
  index.clear();
  assert.equal(index.count, 0);
  assert.equal(index.fileCount, 0);
  assert.equal(index.getAllEndpoints().length, 0);
});

test('parseEndpointsFromCSharp fast-paths and ignores non-endpoint C# files', () => {
  const modelCode = `
namespace MyProject.Models;
public class UserModel {
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
}
`;
  const endpoints = parseEndpointsFromCSharp(modelCode, '/src/Models/UserModel.cs', 'MyProject', 'Models/UserModel.cs');
  assert.equal(endpoints.length, 0);
});

test('parseEndpointsFromCSharp parses separate Http and Route attributes with custom decorators', () => {
  const code = `
public class ProjectController : ControllerBase
{
    [HttpPost]
    [Route("{projectId:int}/invite")]
    public async Task<Guid> InviteUser([FromRoute] int projectId) => Guid.NewGuid();

    [Route("{projectId:guid}/members")]
    [HttpGet]
    public async Task<IActionResult> GetMembers([FromRoute] Guid projectId) => Ok();

    [FeatureAccessControl("Project", "Invite")]
    [HttpPost("{projectId:int}/confirm")]
    [ProducesResponseType(200)]
    public async Task<IActionResult> Confirm([FromRoute] int projectId) => Ok();
}
`;
  const endpoints = parseEndpointsFromCSharp(code, '/ProjectController.cs', 'MyProject', 'ProjectController.cs');

  assert.ok(endpoints.some(e => e.httpMethod === 'POST' && e.routeTemplate.includes('{projectId:int}/invite')));
  assert.ok(endpoints.some(e => e.httpMethod === 'GET' && e.routeTemplate.includes('{projectId:guid}/members')));
  assert.ok(endpoints.some(e => e.httpMethod === 'POST' && e.routeTemplate.includes('{projectId:int}/confirm')));
});

