import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import Module from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { ProjectModel, RunConfig, SolutionModel } from '../models';

const events: string[] = [];
const vscodeMock = {
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    getConfiguration: () => ({
      get: <T>(_key: string, fallback: T) => fallback,
      inspect: () => undefined
    })
  },
  window: {
    showQuickPick: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: () => undefined
  },
  debug: {
    startDebugging: async () => {
      events.push('start');
      return true;
    }
  }
};

const moduleWithLoader = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = function (request: string, parent: unknown, isMain: boolean) {
  return request === 'vscode' ? vscodeMock : originalLoad(request, parent, isMain);
};

const { runConfig } = require('../debugRunner') as typeof import('../debugRunner');

test('compound Smart Build completes before any target starts', async () => {
  const fixture = await createFixture();
  try {
    events.length = 0;
    await runConfig(fixture.solution, fixture.config, {
      debug: false,
      buildMode: 'smart',
      smartPrebuild: async () => {
        events.push('smart-build');
        return true;
      }
    });
    assert.deepEqual(events, ['smart-build', 'start', 'start']);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('failed Smart Build prevents every run target from starting', async () => {
  const fixture = await createFixture();
  try {
    events.length = 0;
    await runConfig(fixture.solution, fixture.config, {
      debug: true,
      buildMode: 'smart',
      smartPrebuild: async () => {
        events.push('smart-build-failed');
        return false;
      }
    });
    assert.deepEqual(events, ['smart-build-failed']);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('none mode starts existing outputs without invoking a prebuild', async () => {
  const fixture = await createFixture();
  try {
    events.length = 0;
    await runConfig(fixture.solution, fixture.config, {
      debug: false,
      buildMode: 'none',
      smartPrebuild: async () => {
        events.push('unexpected-build');
        return true;
      }
    });
    assert.deepEqual(events, ['start', 'start']);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

async function createFixture(): Promise<{ root: string; solution: SolutionModel; config: RunConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dotnav-run-smart-'));
  const projects: ProjectModel[] = [];
  for (const name of ['Api', 'Worker']) {
    const directory = path.join(root, name);
    await fs.mkdir(path.join(directory, 'bin', 'Debug', 'net6.0'), { recursive: true });
    const projectPath = path.join(directory, `${name}.csproj`);
    await fs.writeFile(projectPath, '<Project Sdk="Microsoft.NET.Sdk" />');
    await fs.writeFile(path.join(directory, 'bin', 'Debug', 'net6.0', `${name}.dll`), name);
    projects.push({
      name, path: projectPath, directory, relativePath: `${name}/${name}.csproj`, kind: 'console',
      targetFrameworks: ['net6.0'], launchProfiles: [], packageReferences: [], projectReferences: [], assemblyName: name
    });
  }
  const solution: SolutionModel = { name: 'Test', rootPath: root, projects };
  const config: RunConfig = {
    id: 'compound:test', label: 'Test compound', kind: 'compound',
    targets: projects.map(project => ({ projectPath: project.path }))
  };
  return { root, solution, config };
}
