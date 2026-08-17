import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractProcessName, findMatchingProject, isLikelyDotnetProcess } from '../processDiscovery';
import { ProjectModel } from '../models';

test('identifies likely .NET processes and filters noise', () => {
  assert.equal(isLikelyDotnetProcess('dotnet exec "C:\\Projects\\MyApi\\bin\\Debug\\net8.0\\MyApi.dll"'), true);
  assert.equal(isLikelyDotnetProcess('C:\\Program Files\\dotnet\\dotnet.exe run'), true);
  assert.equal(isLikelyDotnetProcess('node C:\\VSCode\\extensions\\buildhost.js'), false);
  assert.equal(isLikelyDotnetProcess('C:\\Tools\\Roslyn\\VBCSCompiler.exe'), false);
  assert.equal(isLikelyDotnetProcess('notepad.exe'), false);
});

test('matches running process to workspace project', () => {
  const dummyProject: ProjectModel = {
    name: 'MyAwesomeApi',
    path: 'D:\\Projects\\MySolution\\src\\MyAwesomeApi\\MyAwesomeApi.csproj',
    directory: 'D:\\Projects\\MySolution\\src\\MyAwesomeApi',
    relativePath: 'src/MyAwesomeApi/MyAwesomeApi.csproj',
    kind: 'web',
    targetFrameworks: ['net8.0'],
    launchProfiles: [],
    packageReferences: [],
    projectReferences: []
  };

  const matched = findMatchingProject(
    'dotnet exec "D:\\Projects\\MySolution\\src\\MyAwesomeApi\\bin\\Debug\\net8.0\\MyAwesomeApi.dll"',
    [dummyProject]
  );
  assert.ok(matched);
  assert.equal(matched.name, 'MyAwesomeApi');

  const unmatched = findMatchingProject(
    'dotnet exec "D:\\Other\\OtherService.dll"',
    [dummyProject]
  );
  assert.equal(unmatched, undefined);
});

test('extracts clean process name from command line or path', () => {
  assert.equal(extractProcessName('dotnet exec "C:\\app\\WeatherService.dll"'), 'WeatherService.dll');
  assert.equal(extractProcessName('C:\\dotnet\\dotnet.exe', 'C:\\dotnet\\dotnet.exe'), 'dotnet.exe');
});
