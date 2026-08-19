import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProjectModel } from '../models';
import { computeNamespace, renderTemplate, useFileScoped } from '../templates';

test('computeNamespace generates proper namespace from project rootNamespace and folder', () => {
  const dummyProject: ProjectModel = {
    name: 'MyCompany.App',
    path: '/repo/src/MyCompany.App/MyCompany.App.csproj',
    directory: '/repo/src/MyCompany.App',
    relativePath: 'src/MyCompany.App/MyCompany.App.csproj',
    metadataLoaded: true,
    kind: 'web',
    rootNamespace: 'MyCompany.App',
    targetFrameworks: ['net8.0'],
    launchProfiles: [],
    packageReferences: [],
    projectReferences: []
  };

  const ns = computeNamespace(dummyProject, '/repo/src/MyCompany.App/Services/Orders/Handlers');
  assert.equal(ns, 'MyCompany.App.Services.Orders.Handlers');
});

test('renderTemplate renders class, interface, record, struct, recordStruct, enum, controller, and exception', () => {
  const classContent = renderTemplate('class', 'OrderService', 'MyCompany.App', true);
  assert.equal(classContent, 'namespace MyCompany.App;\n\npublic class OrderService\n{\n}\n');

  const interfaceContent = renderTemplate('interface', 'IOrderService', 'MyCompany.App', true);
  assert.equal(interfaceContent, 'namespace MyCompany.App;\n\npublic interface IOrderService\n{\n}\n');

  const recordContent = renderTemplate('record', 'CreateOrderCommand', 'MyCompany.App', true);
  assert.equal(recordContent, 'namespace MyCompany.App;\n\npublic record CreateOrderCommand;\n');

  const structContent = renderTemplate('struct', 'Point2D', 'MyCompany.App', true);
  assert.equal(structContent, 'namespace MyCompany.App;\n\npublic struct Point2D\n{\n}\n');

  const recordStructContent = renderTemplate('recordStruct', 'Coordinates', 'MyCompany.App', true);
  assert.equal(recordStructContent, 'namespace MyCompany.App;\n\npublic record struct Coordinates;\n');

  const enumContent = renderTemplate('enum', 'OrderStatus', 'MyCompany.App', true);
  assert.equal(enumContent, 'namespace MyCompany.App;\n\npublic enum OrderStatus\n{\n}\n');

  const controllerContent = renderTemplate('controller', 'OrdersController', 'MyCompany.App.Controllers', true);
  assert.ok(controllerContent.includes('using Microsoft.AspNetCore.Mvc;'));
  assert.ok(controllerContent.includes('namespace MyCompany.App.Controllers;'));
  assert.ok(controllerContent.includes('[ApiController]'));
  assert.ok(controllerContent.includes('public class OrdersController : ControllerBase'));

  const exceptionContent = renderTemplate('exception', 'OrderNotFoundException', 'MyCompany.App.Exceptions', true);
  assert.ok(exceptionContent.includes('namespace MyCompany.App.Exceptions;'));
  assert.ok(exceptionContent.includes('public class OrderNotFoundException : Exception'));
  assert.ok(exceptionContent.includes('public OrderNotFoundException(string message) : base(message)'));
});

test('renderTemplate supports block scoped namespace for legacy .NET Framework', () => {
  const classContent = renderTemplate('class', 'LegacyService', 'MyCompany.Legacy', false);
  assert.equal(classContent, 'namespace MyCompany.Legacy\n{\n    public class LegacyService\n    {\n    }\n}\n');
});

test('useFileScoped detects .NET 6+ projects', () => {
  const modernProject: ProjectModel = {
    name: 'ModernApp',
    path: '/repo/ModernApp.csproj',
    directory: '/repo',
    relativePath: 'ModernApp.csproj',
    metadataLoaded: true,
    kind: 'web',
    targetFrameworks: ['net8.0'],
    launchProfiles: [],
    packageReferences: [],
    projectReferences: []
  };

  const legacyProject: ProjectModel = {
    name: 'LegacyApp',
    path: '/repo/LegacyApp.csproj',
    directory: '/repo',
    relativePath: 'LegacyApp.csproj',
    metadataLoaded: true,
    kind: 'library',
    targetFrameworks: ['net48'],
    launchProfiles: [],
    packageReferences: [],
    projectReferences: []
  };

  assert.equal(useFileScoped(modernProject), true);
  assert.equal(useFileScoped(legacyProject), false);
});
