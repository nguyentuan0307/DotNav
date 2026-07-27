import assert from 'node:assert/strict';
import test from 'node:test';
import * as path from 'path';
import { ProjectKind, ProjectModel, SolutionModel } from '../models';
import { detectEfProjects, migrationProjectCandidates } from '../ef/efDetection';

const root = path.resolve('/repo');

function project(
  name: string,
  kind: ProjectKind,
  packages: string[],
  references: string[] = []
): ProjectModel {
  const projectPath = path.join(root, name, `${name}.csproj`);
  return {
    name,
    path: projectPath,
    directory: path.dirname(projectPath),
    relativePath: `${name}/${name}.csproj`,
    kind,
    targetFrameworks: ['net8.0'],
    launchProfiles: [],
    packageReferences: packages.map(pkg => ({ name: pkg, version: '8.0.0' })),
    projectReferences: references.map(reference => ({
      name: reference,
      path: path.join(root, reference, `${reference}.csproj`)
    }))
  };
}

function solution(projects: ProjectModel[]): SolutionModel {
  return { name: 'Test', rootPath: root, projects };
}

test('detects migrations project and startup candidates through transitive references', () => {
  const data = project('MyApp.Data', 'library', [
    'Microsoft.EntityFrameworkCore',
    'Microsoft.EntityFrameworkCore.Design'
  ]);
  const services = project('MyApp.Services', 'library', [], ['MyApp.Data']);
  const web = project('MyApp.Web', 'web', [], ['MyApp.Services']);
  const unrelated = project('MyApp.Cli', 'console', []);

  const detections = detectEfProjects(solution([data, services, web, unrelated]));
  assert.equal(detections.length, 1);
  assert.equal(detections[0].project.name, 'MyApp.Data');
  assert.equal(detections[0].hasDesignPackage, true);
  assert.deepEqual(detections[0].startupCandidates.map(candidate => candidate.name), ['MyApp.Web']);
});

test('single-project app is its own startup candidate', () => {
  const app = project('MyApp', 'web', ['Microsoft.EntityFrameworkCore.SqlServer']);
  const detections = detectEfProjects(solution([app]));
  assert.equal(detections.length, 1);
  assert.deepEqual(detections[0].startupCandidates.map(candidate => candidate.name), ['MyApp']);
  assert.equal(detections[0].hasDesignPackage, false);
});

test('detects provider packages such as Npgsql and Pomelo', () => {
  const npgsql = project('PgData', 'library', ['Npgsql.EntityFrameworkCore.PostgreSQL']);
  const pomelo = project('MyData', 'library', ['Pomelo.EntityFrameworkCore.MySql']);
  const web = project('Web', 'web', [], ['PgData', 'MyData']);

  const detections = detectEfProjects(solution([npgsql, pomelo, web]));
  assert.deepEqual(detections.map(detection => detection.project.name), ['MyData', 'PgData']);
});

test('a Migrations folder marks a project as EF even without package references', () => {
  const shared = project('SharedInfra', 'library', []);
  const web = project('Web', 'web', [], ['SharedInfra']);
  const extra = new Set([shared.path]);

  const detections = detectEfProjects(solution([shared, web]), extra);
  assert.equal(detections.length, 1);
  assert.equal(detections[0].project.name, 'SharedInfra');
  assert.equal(detections[0].hasMigrationsFolder, true);
  assert.deepEqual(detections[0].startupCandidates.map(candidate => candidate.name), ['Web']);

  const candidates = migrationProjectCandidates(detections);
  assert.equal(candidates.length, 1);
});

test('ignores projects without EF packages', () => {
  const library = project('Plain', 'library', ['Newtonsoft.Json']);
  assert.equal(detectEfProjects(solution([library])).length, 0);
});

test('candidates prefer projects with the design package', () => {
  const data = project('Data', 'library', ['Microsoft.EntityFrameworkCore.Design', 'Microsoft.EntityFrameworkCore']);
  const shared = project('Shared', 'library', ['Microsoft.EntityFrameworkCore']);
  const web = project('Web', 'web', [], ['Data', 'Shared']);

  const detections = detectEfProjects(solution([data, shared, web]));
  assert.equal(detections.length, 2);

  const candidates = migrationProjectCandidates(detections);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].project.name, 'Data');
});

test('falls back to reachable EF projects when nothing has the design package', () => {
  const shared = project('Shared', 'library', ['Microsoft.EntityFrameworkCore']);
  const orphan = project('Orphan', 'library', ['Microsoft.EntityFrameworkCore']);
  const web = project('Web', 'web', [], ['Shared']);

  const candidates = migrationProjectCandidates(detectEfProjects(solution([shared, orphan, web])));
  assert.deepEqual(candidates.map(candidate => candidate.project.name), ['Shared']);
});

test('ranks the closest-named app as the default startup project', () => {
  // Real ELDesk shape: an Infrastructure project shared by a web app and
  // several Hangfire hosts.
  const infra = project('ELDesk.CustomApp.Infrastructure', 'library', [
    'Microsoft.EntityFrameworkCore.Design'
  ]);
  const web = project('ELDesk.CustomApp', 'web', [], ['ELDesk.CustomApp.Infrastructure']);
  const hangfire = project('ELDesk.CustomApp.HangfireServer', 'console', [], ['ELDesk.CustomApp.Infrastructure']);
  const aggregation = project('ELDesk.CustomApp.Aggregation.HangfireServer', 'console', [], [
    'ELDesk.CustomApp.Infrastructure'
  ]);

  const detections = detectEfProjects(solution([infra, aggregation, hangfire, web]));
  assert.equal(detections.length, 1);
  assert.equal(
    detections[0].startupCandidates[0].name,
    'ELDesk.CustomApp',
    'the web app must win over the Hangfire hosts'
  );
  assert.ok(
    detections[0].startupCandidates.map(candidate => candidate.name).includes('ELDesk.CustomApp.HangfireServer'),
    'background hosts stay selectable, just not first'
  );
});

test('prefers the longest matching name prefix', () => {
  const infra = project('Acme.Billing.Data', 'library', ['Microsoft.EntityFrameworkCore.Design']);
  const outer = project('Acme', 'web', [], ['Acme.Billing.Data']);
  const inner = project('Acme.Billing', 'web', [], ['Acme.Billing.Data']);

  const detections = detectEfProjects(solution([infra, outer, inner]));
  assert.equal(detections[0].startupCandidates[0].name, 'Acme.Billing');
});
