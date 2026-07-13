import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectsUnderFolder, sortProjectsByReferences } from '../folderBuild';
import { ProjectModel, SolutionModel } from '../models';

function project(name: string, projectPath: string, references: string[] = []): ProjectModel {
  return {
    name, path: projectPath, directory: projectPath.replace(/\/[^/]+$/, ''), relativePath: projectPath,
    kind: 'library', targetFrameworks: [], launchProfiles: [], packageReferences: [],
    projectReferences: references.map(reference => ({ name: reference, path: reference }))
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

test('orders folder projects dependency-first and tolerates cycles', () => {
  const a = project('A', '/repo/A.csproj', ['/repo/B.csproj']);
  const b = project('B', '/repo/B.csproj');
  assert.deepEqual(sortProjectsByReferences([a, b]).map(item => item.name), ['B', 'A']);
  const cyclicA = project('A', '/repo/A.csproj', ['/repo/B.csproj']);
  const cyclicB = project('B', '/repo/B.csproj', ['/repo/A.csproj']);
  assert.deepEqual(new Set(sortProjectsByReferences([cyclicA, cyclicB]).map(item => item.name)), new Set(['A', 'B']));
});
