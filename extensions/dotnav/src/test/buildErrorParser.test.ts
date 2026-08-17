import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBuildDiagnostics } from '../buildErrorParser';

test('parses standard MSBuild error and warning lines', () => {
  const output = `
Microsoft (R) Build Engine version 17.8.3+195e4f5a3 for .NET
Copyright (C) Microsoft Corporation. All rights reserved.

  Determining projects to restore...
  All projects are up-to-date for restore.
d:\\Projects\\MyApp\\Controllers\\WeatherForecastController.cs(18,22): error CS0103: The name 'NotFoundResult' does not exist in the current context [d:\\Projects\\MyApp\\MyApp.csproj]
d:\\Projects\\MyApp\\Services\\DataService.cs(45,13): warning CS0168: The variable 'ex' is declared but never used [d:\\Projects\\MyApp\\MyApp.csproj]

Build FAILED.
  `;

  const diagnostics = parseBuildDiagnostics(output);
  assert.equal(diagnostics.length, 2);

  assert.equal(diagnostics[0].file, 'd:\\Projects\\MyApp\\Controllers\\WeatherForecastController.cs');
  assert.equal(diagnostics[0].line, 18);
  assert.equal(diagnostics[0].column, 22);
  assert.equal(diagnostics[0].severity, 'error');
  assert.equal(diagnostics[0].code, 'CS0103');
  assert.equal(diagnostics[0].message, "The name 'NotFoundResult' does not exist in the current context [d:\\Projects\\MyApp\\MyApp.csproj]");

  assert.equal(diagnostics[1].file, 'd:\\Projects\\MyApp\\Services\\DataService.cs');
  assert.equal(diagnostics[1].line, 45);
  assert.equal(diagnostics[1].column, 13);
  assert.equal(diagnostics[1].severity, 'warning');
  assert.equal(diagnostics[1].code, 'CS0168');
});

test('handles output with no diagnostics gracefully', () => {
  const output = `
Build succeeded.
    0 Warning(s)
    0 Error(s)
  `;

  const diagnostics = parseBuildDiagnostics(output);
  assert.deepEqual(diagnostics, []);
});
