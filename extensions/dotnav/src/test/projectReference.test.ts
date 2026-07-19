import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProjectModel, SolutionModel } from '../models';
import { candidateReferenceProjects } from '../projectReferenceCommands';

function project(name: string, projectPath: string, references: string[] = []): ProjectModel {
  return {
    name,
    path: projectPath,
    directory: projectPath.replace(/[\\/][^\\/]+$/, ''),
    relativePath: projectPath,
    kind: 'library',
    targetFrameworks: [],
    launchProfiles: [],
    packageReferences: [],
    projectReferences: references.map(reference => ({
      name: reference.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, ''),
      path: reference
    }))
  };
}

function solution(projects: ProjectModel[]): SolutionModel {
  return { name: 'Test', rootPath: '/repo', projects };
}

test('excludes the current project', () => {
  const current = project('Api', '/repo/Api/Api.csproj');
  const domain = project('Domain', '/repo/Domain/Domain.csproj');

  assert.deepEqual(candidateReferenceProjects(solution([current, domain]), current), [domain]);
});

test('excludes projects already referenced by the current project', () => {
  const domain = project('Domain', '/repo/Domain/Domain.csproj');
  const current = project('Api', '/repo/Api/Api.csproj', [domain.path]);

  assert.deepEqual(candidateReferenceProjects(solution([current, domain]), current), []);
});

test('excludes projects that would create a direct cycle', () => {
  const current = project('Api', '/repo/Api/Api.csproj');
  const application = project('Application', '/repo/Application/Application.csproj', [current.path]);

  assert.deepEqual(candidateReferenceProjects(solution([current, application]), current), []);
});

test('returns no candidates for a single-project solution', () => {
  const current = project('Api', '/repo/Api/Api.csproj');

  assert.deepEqual(candidateReferenceProjects(solution([current]), current), []);
});

test('compares Windows paths without case or separator sensitivity', {
  skip: process.platform !== 'win32'
}, () => {
  const current = project('Api', 'C:\\Repo\\Api\\Api.csproj', ['C:\\REPO\\DOMAIN\\DOMAIN.CSPROJ']);
  const sameProject = project('Api alias', 'c:/repo/api/api.csproj');
  const referenced = project('Domain', 'c:/repo/domain/domain.csproj');
  const available = project('Infrastructure', 'C:/Repo/Infrastructure/Infrastructure.csproj');

  assert.deepEqual(
    candidateReferenceProjects(solution([sameProject, referenced, available]), current),
    [available]
  );
});
