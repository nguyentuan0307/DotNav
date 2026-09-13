import * as assert from 'assert';
import { describe, it } from 'node:test';
import * as path from 'path';
import { ProjectModel } from '../models';
import {
  filterProjectsByScope,
  matchesSolutionFolder,
  normalizeFsPath,
  resolveScopeProjectPaths
} from '../scope/scopeResolver';
import { ScopeTarget } from '../scope/scopeModel';

function createMockProject(
  name: string,
  relativePath: string,
  solutionFolder?: string[],
  projectReferences: { name: string; path: string }[] = []
): ProjectModel {
  const root = path.resolve('/workspace');
  const projPath = path.resolve(root, relativePath);
  return {
    name,
    path: projPath,
    directory: path.dirname(projPath),
    relativePath,
    metadataLoaded: true,
    kind: 'library',
    targetFrameworks: ['net8.0'],
    launchProfiles: [],
    packageReferences: [],
    projectReferences,
    solutionFolder
  };
}

describe('ScopeResolver', () => {
  describe('matchesSolutionFolder', () => {
    it('matches exact solution folder', () => {
      assert.strictEqual(matchesSolutionFolder(['Services', 'CustomApp'], 'Services/CustomApp'), true);
      assert.strictEqual(matchesSolutionFolder(['Services', 'CustomApp'], 'Services\\CustomApp'), true);
    });

    it('matches nested subfolders', () => {
      assert.strictEqual(matchesSolutionFolder(['Services', 'CustomApp', 'Jobs'], 'Services/CustomApp'), true);
    });

    it('rejects non-matching folders', () => {
      assert.strictEqual(matchesSolutionFolder(['Services', 'Work'], 'Services/CustomApp'), false);
      assert.strictEqual(matchesSolutionFolder([], 'Services/CustomApp'), false);
      assert.strictEqual(matchesSolutionFolder(undefined, 'Services/CustomApp'), false);
    });

    it('is case-insensitive', () => {
      assert.strictEqual(matchesSolutionFolder(['services', 'customapp'], 'Services/CustomApp'), true);
    });
  });

  describe('resolveScopeProjectPaths & Closure Union', () => {
    const root = path.resolve('/workspace');
    const sharedDomainPath = path.resolve(root, 'src/Shared/ELDesk.Shared.Domain/ELDesk.Shared.Domain.csproj');
    const sharedInfraPath = path.resolve(root, 'src/Shared/ELDesk.Shared.Infra/ELDesk.Shared.Infra.csproj');
    const customAppDomainPath = path.resolve(root, 'src/Services/CustomApp/CustomApp.Domain/CustomApp.Domain.csproj');
    const customAppApiPath = path.resolve(root, 'src/Services/CustomApp/CustomApp.Api/CustomApp.Api.csproj');
    const workDomainPath = path.resolve(root, 'src/Services/Work/Work.Domain/Work.Domain.csproj');
    const workApiPath = path.resolve(root, 'src/Services/Work/Work.Api/Work.Api.csproj');
    const accountingApiPath = path.resolve(root, 'src/Services/Accounting/Accounting.Api/Accounting.Api.csproj');

    const sharedDomain = createMockProject('ELDesk.Shared.Domain', 'src/Shared/ELDesk.Shared.Domain/ELDesk.Shared.Domain.csproj', ['Shared']);
    const sharedInfra = createMockProject('ELDesk.Shared.Infra', 'src/Shared/ELDesk.Shared.Infra/ELDesk.Shared.Infra.csproj', ['Shared'], [
      { name: 'ELDesk.Shared.Domain', path: sharedDomainPath }
    ]);
    const customAppDomain = createMockProject('CustomApp.Domain', 'src/Services/CustomApp/CustomApp.Domain/CustomApp.Domain.csproj', ['Services', 'CustomApp'], [
      { name: 'ELDesk.Shared.Domain', path: sharedDomainPath }
    ]);
    const customAppApi = createMockProject('CustomApp.Api', 'src/Services/CustomApp/CustomApp.Api/CustomApp.Api.csproj', ['Services', 'CustomApp'], [
      { name: 'CustomApp.Domain', path: customAppDomainPath },
      { name: 'ELDesk.Shared.Infra', path: sharedInfraPath }
    ]);

    const workDomain = createMockProject('Work.Domain', 'src/Services/Work/Work.Domain/Work.Domain.csproj', ['Services', 'Work'], [
      { name: 'ELDesk.Shared.Domain', path: sharedDomainPath }
    ]);
    const workApi = createMockProject('Work.Api', 'src/Services/Work/Work.Api/Work.Api.csproj', ['Services', 'Work'], [
      { name: 'Work.Domain', path: workDomainPath }
    ]);

    const accountingApi = createMockProject('Accounting.Api', 'src/Services/Accounting/Accounting.Api/Accounting.Api.csproj', ['Services', 'Accounting']);

    const allProjects = [
      sharedDomain,
      sharedInfra,
      customAppDomain,
      customAppApi,
      workDomain,
      workApi,
      accountingApi
    ];

    it('resolves single project without dependencies when disabled', () => {
      const targets: ScopeTarget[] = [{ kind: 'project', value: customAppApi.path }];
      const resolved = resolveScopeProjectPaths(allProjects, targets, false);

      assert.strictEqual(resolved.length, 1);
      assert.strictEqual(resolved[0], normalizeFsPath(customAppApi.path));
    });

    it('resolves single project with full transitive dependencies', () => {
      const targets: ScopeTarget[] = [{ kind: 'project', value: customAppApi.path }];
      const resolved = resolveScopeProjectPaths(allProjects, targets, true);

      // customAppApi -> customAppDomain -> sharedDomain
      // customAppApi -> sharedInfra -> sharedDomain
      const expected = new Set([
        normalizeFsPath(customAppApi.path),
        normalizeFsPath(customAppDomain.path),
        normalizeFsPath(sharedInfra.path),
        normalizeFsPath(sharedDomain.path)
      ]);

      assert.strictEqual(resolved.length, 4);
      for (const p of resolved) {
        assert.ok(expected.has(p), `Unexpected project in resolution: ${p}`);
      }
    });

    it('resolves solution folder targets and includes all member projects', () => {
      const targets: ScopeTarget[] = [{ kind: 'solutionFolder', value: 'Services/CustomApp' }];
      const resolved = resolveScopeProjectPaths(allProjects, targets, false);

      assert.strictEqual(resolved.length, 2);
      assert.ok(resolved.includes(normalizeFsPath(customAppApi.path)));
      assert.ok(resolved.includes(normalizeFsPath(customAppDomain.path)));
    });

    it('resolves multi-focus composite scope (CustomApp + Work) with shared dependencies', () => {
      const targets: ScopeTarget[] = [
        { kind: 'solutionFolder', value: 'Services/CustomApp' },
        { kind: 'solutionFolder', value: 'Services/Work' }
      ];
      const resolved = resolveScopeProjectPaths(allProjects, targets, true);

      // Should contain: customAppApi, customAppDomain, workApi, workDomain, sharedDomain, sharedInfra
      // Should NOT contain: accountingApi
      const resolvedSet = new Set(resolved);
      assert.ok(resolvedSet.has(normalizeFsPath(customAppApi.path)));
      assert.ok(resolvedSet.has(normalizeFsPath(customAppDomain.path)));
      assert.ok(resolvedSet.has(normalizeFsPath(workApi.path)));
      assert.ok(resolvedSet.has(normalizeFsPath(workDomain.path)));
      assert.ok(resolvedSet.has(normalizeFsPath(sharedDomain.path)));
      assert.ok(resolvedSet.has(normalizeFsPath(sharedInfra.path)));
      assert.strictEqual(resolvedSet.has(normalizeFsPath(accountingApi.path)), false);
      assert.strictEqual(resolved.length, 6);
    });

    it('filters projects by active project paths', () => {
      const activePaths = [customAppApi.path, workApi.path];
      const filtered = filterProjectsByScope(allProjects, activePaths);

      assert.strictEqual(filtered.length, 2);
      assert.strictEqual(filtered[0].name, 'CustomApp.Api');
      assert.strictEqual(filtered[1].name, 'Work.Api');
    });
  });
});
