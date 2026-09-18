import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'node:module';

class MockTask {
  group: unknown;

  constructor(
    readonly definition: any,
    readonly scope: unknown,
    readonly name: string,
    readonly source: string,
    readonly execution: unknown,
    readonly problemMatchers: unknown
  ) {}
}

let extension: any;
let fetchedTasks: any[] = [];
let fetchCount = 0;
let executedTasks: any[] = [];
let executedCommands: string[] = [];
let startListeners: Array<(event: any) => void> = [];
let globalValue: boolean | undefined;
let workspaceValue: boolean | undefined;
const globalState = new Map<string, unknown>();
const workspaceState = new Map<string, unknown>();

const vscodeMock = {
  Task: MockTask,
  TaskScope: { Workspace: 1 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  extensions: {
    getExtension: () => extension
  },
  commands: {
    getCommands: async () => [
      'resharper.solution.build',
      'resharper.solution.rebuild',
      'resharper.solution.clean',
      'resharper.solutionExplorer.focus'
    ],
    executeCommand: async (command: string) => {
      executedCommands.push(command);
      if (command.startsWith('resharper.solution.') && command !== 'resharper.solutionExplorer.focus') {
        const target = `${command.slice('resharper.solution.'.length, 1 + 'resharper.solution.'.length).toUpperCase()}${command.slice(1 + 'resharper.solution.'.length)}`;
        const execution = { task: { definition: { type: 'resharper-build', target } } };
        for (const listener of [...startListeners]) listener({ execution });
      }
    }
  },
  tasks: {
    fetchTasks: async () => {
      fetchCount++;
      return fetchedTasks;
    },
    executeTask: async (task: any) => {
      executedTasks.push(task);
      return { task };
    },
    onDidStartTask: (listener: (event: any) => void) => {
      startListeners.push(listener);
      return { dispose: () => { startListeners = startListeners.filter(candidate => candidate !== listener); } };
    }
  },
  workspace: {
    getConfiguration: () => ({
      inspect: () => ({ globalValue, workspaceValue }),
      update: async (_key: string, value: boolean | undefined, target?: number) => {
        if (target === 1) {
          globalValue = value;
        } else {
          workspaceValue = value;
        }
      }
    })
  },
  window: {
    createOutputChannel: () => ({ appendLine: () => {}, show: () => {}, dispose: () => {} }),
    showInformationMessage: () => undefined
  }
};

const moduleWithLoader = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = function load(request, parent, isMain) {
  return request === 'vscode' ? vscodeMock : originalLoad(request, parent, isMain);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ReSharperBuildRequest, ReSharperIntegration } = require('../resharperIntegration') as typeof import('../resharperIntegration');

function reset(): void {
  extension = {
    isActive: false,
    activate: async () => { extension.isActive = true; }
  };
  fetchedTasks = [];
  fetchCount = 0;
  executedTasks = [];
  executedCommands = [];
  startListeners = [];
  globalValue = undefined;
  workspaceValue = undefined;
  globalState.clear();
  workspaceState.clear();
  vscodeMock.tasks.fetchTasks = async () => {
    fetchCount++;
    return fetchedTasks;
  };
}

function createIntegration(timeout = 50, poll = 1): import('../resharperIntegration').ReSharperIntegration {
  const context = {
    workspaceState: {
      get: <T>(key: string) => workspaceState.get(key) as T | undefined,
      update: async (key: string, value: unknown) => {
        if (value === undefined) workspaceState.delete(key);
        else workspaceState.set(key, value);
      }
    },
    globalState: {
      get: <T>(key: string) => globalState.get(key) as T | undefined,
      update: async (key: string, value: unknown) => {
        if (value === undefined) globalState.delete(key);
        else globalState.set(key, value);
      }
    }
  } as any;
  return new ReSharperIntegration(context, timeout, poll);
}

test('ReSharperIntegration activates extension, waits for provider, and normalizes project paths', async () => {
  reset();
  const execution = { kind: 'custom' };
  const template = { definition: { type: 'resharper-build', target: 'Rebuild' }, execution, problemMatchers: ['$msCompile'] };
  let attempts = 0;
  vscodeMock.tasks.fetchTasks = async () => {
    fetchCount++;
    return ++attempts < 2 ? [] : [template];
  };

  const integration = createIntegration();
  await integration.executeBuild(new ReSharperBuildRequest('Rebuild', ['./Sample.csproj', './Sample.csproj'], 'rebuild Sample'));

  assert.equal(extension.isActive, true);
  assert.equal(fetchCount, 2);
  assert.equal(executedTasks.length, 1);
  assert.equal(executedTasks[0].execution, execution);
  assert.deepEqual(executedTasks[0].definition.projectFiles, [require('node:path').resolve('./Sample.csproj')]);
  integration.dispose();
});

test('ReSharperIntegration maps native solution Build, Rebuild, and Clean commands', async () => {
  reset();
  fetchedTasks = ['Build', 'Rebuild', 'Clean'].map(target => ({
    definition: { type: 'resharper-build', target },
    execution: { kind: 'custom' }
  }));
  const integration = createIntegration();

  for (const target of ['Build', 'Rebuild', 'Clean'] as const) {
    const execution = await integration.executeSolutionBuild(new ReSharperBuildRequest(target, [], `${target} solution`));
    assert.equal(execution.task.definition.target, target);
  }

  assert.deepEqual(executedCommands.filter(command => command.startsWith('resharper.solution.')), [
    'resharper.solution.build',
    'resharper.solution.rebuild',
    'resharper.solution.clean'
  ]);
  integration.dispose();
});

test('ReSharperIntegration reports an unavailable provider without creating a dotnet task', async () => {
  reset();
  const integration = createIntegration(10, 1);
  await assert.rejects(
    integration.executeBuild(new ReSharperBuildRequest('Build', ['./Sample.csproj'], 'build Sample')),
    /ReSharper Build is not ready/
  );
  assert.equal(executedTasks.length, 0);
  integration.dispose();
});

test('ReSharperIntegration sets buildBeforeLaunch at Global level and cleans workspace value', async () => {
  reset();
  workspaceValue = false; // simulates a previous workspace-level value
  const integration = createIntegration();
  await integration.syncBuildOwnership(true);
  assert.equal(globalValue, false);
  assert.equal(workspaceValue, undefined); // cleaned from workspace
  await integration.restoreBuildOwnership();
  assert.equal(globalValue, undefined);

  await integration.syncBuildOwnership(true);
  globalValue = true;
  await integration.restoreBuildOwnership();
  assert.equal(globalValue, true);
  integration.dispose();
});
