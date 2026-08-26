import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFolderBuildProject, normalizeMaxParallelBuilds, projectsUnderFolder, projectsUnderSolutionFolder, sortProjectsByReferences } from '../folderBuild';
import { ProjectModel, SolutionModel } from '../models';

function project(name: string, projectPath: string, references: string[] = [], solutionFolder?: string[]): ProjectModel {
  return {
    name, path: projectPath, directory: projectPath.replace(/\/[^/]+$/, ''), relativePath: projectPath,
    kind: 'library', targetFrameworks: [], launchProfiles: [], packageReferences: [],
    projectReferences: references.map(reference => ({ name: reference, path: reference })), solutionFolder
  };
}

test('selects every project recursively under a folder', () => {
  const solution: SolutionModel = {
    name: 'test', rootPath: '/repo', projects: [
      project('A', '/repo/src/A/A.csproj'), project('B', '/repo/src/nested/B.csproj'), project('C', '/repo/tests/C.csproj')
    ]
  };
  assert.deepEqual(projectsUnderFolder(solution, '/repo/src').map(item => item.name), ['A', 'B']);
});

test('selects projects recursively from a logical solution folder without requiring a disk folder', () => {
  const solution: SolutionModel = {
    name: 'test', rootPath: '/repo', projects: [
      project('A', '/elsewhere/A.csproj', [], ['Services']),
      project('B', '/repo/src/B.csproj', [], ['Services', 'Internal']),
      project('C', '/repo/tests/C.csproj', [], ['Tests'])
    ]
  };
  assert.deepEqual(projectsUnderSolutionFolder(solution, ['services']).map(item => item.name), ['A', 'B']);
  assert.deepEqual(projectsUnderSolutionFolder(solution, ['Services', 'Internal']).map(item => item.name), ['B']);
});

test('orders folder projects dependency-first and tolerates cycles', () => {
  const a = project('A', '/repo/A.csproj', ['/repo/B.csproj']);
  const b = project('B', '/repo/B.csproj');
  assert.deepEqual(sortProjectsByReferences([a, b]).map(item => item.name), ['B', 'A']);
  const cyclicA = project('A', '/repo/A.csproj', ['/repo/B.csproj']);
  const cyclicB = project('B', '/repo/B.csproj', ['/repo/A.csproj']);
  assert.deepEqual(new Set(sortProjectsByReferences([cyclicA, cyclicB]).map(item => item.name)), new Set(['A', 'B']));
});

test('creates one parallel restore and build orchestration with XML-safe project paths', () => {
  const xml = createFolderBuildProject([
    project('A', '/repo/A & tools/A.csproj'),
    project('B', '/repo/B/B<special>.csproj')
  ]);
  assert.match(xml, /Include="\/repo\/A &amp; tools\/A\.csproj"/);
  assert.match(xml, /Include="\/repo\/B\/B&lt;special&gt;\.csproj"/);
  assert.match(xml, /Name="Restore"/);
  assert.match(xml, /Name="Build" DependsOnTargets="Restore"/);
  assert.equal((xml.match(/BuildInParallel="true"/g) ?? []).length, 2);
  assert.match(xml, /StopOnFirstFailure="true"/);
  assert.match(xml, /Properties="Configuration=\$\(Configuration\)"/);
});

test('normalizes the parallel MSBuild worker limit', () => {
  assert.equal(normalizeMaxParallelBuilds(undefined), 6);
  assert.equal(normalizeMaxParallelBuilds(12), 12);
  assert.equal(normalizeMaxParallelBuilds(2.9), 2);
  assert.equal(normalizeMaxParallelBuilds(0), 1);
  assert.equal(normalizeMaxParallelBuilds(-4), 1);
});
