import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'node:module';
import type { CSharpEnginePreference } from '../engineDetector';

class MockEventEmitter {
  private listeners: Array<(data: any) => void> = [];
  event = (listener: (data: any) => void) => {
    this.listeners.push(listener);
    return { dispose: () => {} };
  };
  fire = (data: any) => {
    for (const listener of this.listeners) {
      listener(data);
    }
  };
  dispose = () => {
    this.listeners = [];
  };
}

const vscodeMock = {
  EventEmitter: MockEventEmitter,
  extensions: {
    onDidChange: () => ({ dispose: () => {} }),
    getExtension: () => undefined
  },
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, fallback: unknown) => fallback,
      update: () => Promise.resolve()
    }),
    onDidChangeConfiguration: () => ({ dispose: () => {} })
  },
  commands: {
    executeCommand: () => Promise.resolve()
  },
  ConfigurationTarget: { Global: 1 }
};

const moduleWithLoader = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = function load(request, parent, isMain) {
  return request === 'vscode' ? vscodeMock : originalLoad(request, parent, isMain);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  EngineDetector,
  MS_CSHARP_EXTENSION_ID,
  MS_CSDEVKIT_EXTENSION_ID,
  RESHARPER_EXTENSION_ID,
  isReSharperActive,
  isReSharperBuildEnabled,
  getActiveEngineDetector
} = require('../engineDetector') as typeof import('../engineDetector');
const { buildDebugConfiguration } = require('../debugRunner') as typeof import('../debugRunner');

function createMockExtension(id: string, version: string, isActive = false): any {
  return {
    id,
    isActive,
    packageJSON: { version }
  };
}

test('EngineDetector - detects none when no C# extensions installed', () => {
  const contextKeys: Record<string, unknown> = {};
  const detector = new EngineDetector({
    getExtension: () => undefined,
    onExtensionsChanged: () => ({ dispose: () => {} }),
    getPreference: () => 'auto',
    setContext: (key, val) => {
      contextKeys[key] = val;
      return Promise.resolve();
    }
  });

  const info = detector.currentInfo;
  assert.equal(info.type, 'none');
  assert.equal(info.activeEngine, 'none');
  assert.equal(info.hasCoreClrDebugger, false);
  assert.equal(info.hasMicrosoftCSharp, false);
  assert.equal(info.hasReSharper, false);
  assert.equal(info.shortLabel, 'No C#');
  assert.equal(contextKeys['dotnav.csharpEngine'], 'none');
  assert.equal(contextKeys['dotnav.activeCSharpEngine'], 'none');
  assert.equal(contextKeys['dotnav.hasCSharpEngine'], false);
  assert.equal(contextKeys['dotnav.hasReSharper'], false);
  assert.equal(contextKeys['dotnav.hasMicrosoftCSharp'], false);

  detector.dispose();
});

test('EngineDetector - detects Microsoft C# when only C# extension is installed', () => {
  const contextKeys: Record<string, unknown> = {};
  const extensions: Record<string, any> = {
    [MS_CSHARP_EXTENSION_ID]: createMockExtension(MS_CSHARP_EXTENSION_ID, '2.45.0', true)
  };

  const detector = new EngineDetector({
    getExtension: id => extensions[id],
    onExtensionsChanged: () => ({ dispose: () => {} }),
    getPreference: () => 'auto',
    setContext: (key, val) => {
      contextKeys[key] = val;
      return Promise.resolve();
    }
  });

  const info = detector.currentInfo;
  assert.equal(info.type, 'microsoft');
  assert.equal(info.activeEngine, 'microsoft');
  assert.equal(info.hasCoreClrDebugger, true);
  assert.equal(info.hasMicrosoftCSharp, true);
  assert.equal(info.hasCsDevKit, false);
  assert.equal(info.hasReSharper, false);
  assert.equal(info.shortLabel, 'Microsoft C#');
  assert.equal(info.microsoftVersion, '2.45.0');
  assert.equal(contextKeys['dotnav.csharpEngine'], 'microsoft');
  assert.equal(contextKeys['dotnav.hasCSharpEngine'], true);

  detector.dispose();
});

test('EngineDetector - detects C# Dev Kit when csdevkit is installed', () => {
  const extensions: Record<string, any> = {
    [MS_CSHARP_EXTENSION_ID]: createMockExtension(MS_CSHARP_EXTENSION_ID, '2.45.0', true),
    [MS_CSDEVKIT_EXTENSION_ID]: createMockExtension(MS_CSDEVKIT_EXTENSION_ID, '1.10.0', true)
  };

  const detector = new EngineDetector({
    getExtension: id => extensions[id],
    onExtensionsChanged: () => ({ dispose: () => {} }),
    getPreference: () => 'auto'
  });

  const info = detector.currentInfo;
  assert.equal(info.type, 'microsoft');
  assert.equal(info.activeEngine, 'microsoft');
  assert.equal(info.hasCsDevKit, true);
  assert.equal(info.shortLabel, 'C# Dev Kit');

  detector.dispose();
});

test('EngineDetector - detects JetBrains ReSharper when only resharper is installed', () => {
  const contextKeys: Record<string, unknown> = {};
  const extensions: Record<string, any> = {
    [RESHARPER_EXTENSION_ID]: createMockExtension(RESHARPER_EXTENSION_ID, '2026.2.2', true)
  };

  const detector = new EngineDetector({
    getExtension: id => extensions[id],
    onExtensionsChanged: () => ({ dispose: () => {} }),
    getPreference: () => 'auto',
    setContext: (key, val) => {
      contextKeys[key] = val;
      return Promise.resolve();
    }
  });

  const info = detector.currentInfo;
  assert.equal(info.type, 'resharper');
  assert.equal(info.activeEngine, 'resharper');
  assert.equal(info.hasCoreClrDebugger, true);
  assert.equal(info.hasMicrosoftCSharp, false);
  assert.equal(info.hasReSharper, true);
  assert.equal(info.shortLabel, 'ReSharper');
  assert.equal(info.resharperVersion, '2026.2.2');
  assert.equal(contextKeys['dotnav.csharpEngine'], 'resharper');
  assert.equal(contextKeys['dotnav.hasReSharper'], true);
  assert.equal(contextKeys['dotnav.hasMicrosoftCSharp'], false);
  assert.equal(contextKeys['dotnav.isReSharperActive'], true);
  assert.equal(contextKeys['dotnav.isReSharperReady'], false);
  assert.equal(contextKeys['dotnav.useReSharperBuild'], true);

  detector.dispose();
});

test('EngineDetector - handles dual stack with preference settings', () => {
  const extensions: Record<string, any> = {
    [MS_CSHARP_EXTENSION_ID]: createMockExtension(MS_CSHARP_EXTENSION_ID, '2.45.0', false),
    [RESHARPER_EXTENSION_ID]: createMockExtension(RESHARPER_EXTENSION_ID, '2026.2.2', false)
  };

  let currentPreference: CSharpEnginePreference = 'auto';

  const detector = new EngineDetector({
    getExtension: id => extensions[id],
    onExtensionsChanged: () => ({ dispose: () => {} }),
    getPreference: () => currentPreference
  });

  // Default auto with both inactive -> resolves to ReSharper to migrate tools
  assert.equal(detector.currentInfo.type, 'dual');
  assert.equal(detector.currentInfo.hasMicrosoftCSharp, true);
  assert.equal(detector.currentInfo.hasReSharper, true);
  assert.equal(detector.currentInfo.activeEngine, 'resharper');

  // Preference: resharper
  currentPreference = 'resharper';
  let refreshed = detector.refresh();
  assert.equal(refreshed.type, 'dual');
  assert.equal(refreshed.activeEngine, 'resharper');
  assert.equal(refreshed.shortLabel, 'ReSharper');

  // Preference: microsoft
  currentPreference = 'microsoft';
  refreshed = detector.refresh();
  assert.equal(refreshed.type, 'dual');
  assert.equal(refreshed.activeEngine, 'microsoft');
  assert.equal(refreshed.shortLabel, 'Microsoft C#');

  detector.dispose();
});

test('EngineDetector - auto mode migrates to ReSharper even when C# Dev Kit is present', () => {
  const extensions: Record<string, any> = {
    [MS_CSHARP_EXTENSION_ID]: createMockExtension(MS_CSHARP_EXTENSION_ID, '2.45.0', true),
    [MS_CSDEVKIT_EXTENSION_ID]: createMockExtension(MS_CSDEVKIT_EXTENSION_ID, '1.10.0', true),
    [RESHARPER_EXTENSION_ID]: createMockExtension(RESHARPER_EXTENSION_ID, '2026.2.2', true)
  };

  const detector = new EngineDetector({
    getExtension: id => extensions[id],
    onExtensionsChanged: () => ({ dispose: () => {} }),
    getPreference: () => 'auto'
  });

  const info = detector.currentInfo;
  assert.equal(info.type, 'dual');
  assert.equal(info.activeEngine, 'resharper');
  assert.equal(info.hasCsDevKit, true);
  assert.equal(info.hasReSharper, true);
  assert.equal(info.shortLabel, 'ReSharper');

  detector.dispose();
});

test('EngineDetector - fires onDidChangeEngine when extension state changes', () => {
  const extensions: Record<string, any> = {};
  let extChangeListener: (() => void) | undefined;

  const detector = new EngineDetector({
    getExtension: id => extensions[id],
    onExtensionsChanged: listener => {
      extChangeListener = listener;
      return { dispose: () => {} };
    },
    getPreference: () => 'auto'
  });

  assert.equal(detector.currentInfo.type, 'none');

  let firedInfo: any;
  detector.onDidChangeEngine((info: any) => {
    firedInfo = info;
  });

  // Dynamically install ReSharper
  extensions[RESHARPER_EXTENSION_ID] = createMockExtension(RESHARPER_EXTENSION_ID, '2026.2.2', true);
  extChangeListener?.();

  assert.ok(firedInfo);
  assert.equal(firedInfo.type, 'resharper');
  assert.equal(detector.currentInfo.type, 'resharper');

  detector.dispose();
});

test('EngineDetector - refreshes engine and build context when preference or build setting changes', () => {
  const extensions: Record<string, any> = {
    [MS_CSHARP_EXTENSION_ID]: createMockExtension(MS_CSHARP_EXTENSION_ID, '2.45.0', true),
    [RESHARPER_EXTENSION_ID]: createMockExtension(RESHARPER_EXTENSION_ID, '2026.2.2', true)
  };
  let preference: CSharpEnginePreference = 'auto';
  let configListener: ((event: any) => void) | undefined;
  const contextKeys: Record<string, unknown> = {};
  const detector = new EngineDetector({
    getExtension: id => extensions[id],
    onExtensionsChanged: () => ({ dispose: () => {} }),
    onConfigChanged: listener => {
      configListener = listener;
      return { dispose: () => {} };
    },
    getPreference: () => preference,
    setContext: (key, value) => {
      contextKeys[key] = value;
      return Promise.resolve();
    }
  });

  assert.equal(contextKeys['dotnav.isReSharperActive'], true);
  assert.equal(contextKeys['dotnav.useReSharperBuild'], true);
  preference = 'microsoft';
  configListener?.({ affectsConfiguration: (key: string) => key === 'dotnav.csharpEngine.preferred' });
  assert.equal(detector.currentInfo.activeEngine, 'microsoft');
  assert.equal(contextKeys['dotnav.isReSharperActive'], false);
  assert.equal(contextKeys['dotnav.useReSharperBuild'], false);
  detector.dispose();
});

test('manifest - decouples from hard ms-dotnettools.csharp dependency', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

  assert.ok(Array.isArray(manifest.extensionDependencies));
  assert.equal(manifest.extensionDependencies.includes('ms-dotnettools.csharp'), false);
  assert.equal(manifest.extensionDependencies.includes('tuna-ex.gitnav-workflows'), true);
});

test('manifest - contributes C# engine preference setting', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

  const pref = manifest.contributes.configuration.properties['dotnav.csharpEngine.preferred'];
  assert.ok(pref);
  assert.equal(pref.default, 'auto');
  assert.deepEqual(pref.enum, ['auto', 'microsoft', 'resharper']);
});

test('manifest - contributes C# engine commands and ReSharper synergy', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

  const commands = new Set(manifest.contributes.commands.map((c: any) => c.command));
  assert.ok(commands.has('dotnav.showCSharpEngineInfo'));
  assert.ok(commands.has('dotnav.resharper.showValueTracking'));
  assert.ok(commands.has('dotnav.resharper.resetPsiCaches'));
  assert.ok(commands.has('dotnav.resharper.attachDebugger'));
  assert.ok(commands.has('dotnav.resharper.userSecrets'));
  assert.ok(commands.has('dotnav.resharper.rearrangeCodeUp'));
  assert.ok(commands.has('dotnav.resharper.rearrangeCodeDown'));
  assert.ok(commands.has('dotnav.resharper.openExplorerForReload'));
  assert.equal(commands.has('dotnav.resharper.reloadAllProjects'), false);
});

test('manifest - contributes ReSharper build setting', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

  const buildSetting = manifest.contributes.configuration.properties['dotnav.resharper.useReSharperBuild'];
  assert.ok(buildSetting);
  assert.equal(buildSetting.default, true);
  assert.equal(buildSetting.type, 'boolean');
});

test('EngineDetector - isReSharperActive helper and buildDebugConfiguration integration', () => {
  const extensions: Record<string, any> = {
    [RESHARPER_EXTENSION_ID]: createMockExtension(RESHARPER_EXTENSION_ID, '2026.2.2', true)
  };

  const detector = new EngineDetector({
    getExtension: id => extensions[id],
    onExtensionsChanged: () => ({ dispose: () => {} }),
    getPreference: () => 'resharper'
  });

  assert.equal(isReSharperActive(), true);
  assert.equal(getActiveEngineDetector(), detector);

  const mockProject: any = {
    name: 'SampleApi',
    path: '/path/to/SampleApi.csproj',
    directory: '/path/to',
    targetFrameworks: ['net8.0']
  };

  const mockProfile: any = {
    name: 'http',
    applicationUrl: 'http://localhost:5000',
    environmentVariables: {
      ASPNETCORE_ENVIRONMENT: 'Development'
    },
    commandLineArgs: '--foo bar'
  };

  const resharperConfig = buildDebugConfiguration(
    mockProject,
    mockProfile,
    true, // debug
    '/path/to/bin/Debug/net8.0/SampleApi.dll',
    'run-1',
    'target-1'
  );

  assert.equal(resharperConfig.type, 'dotnet');
  assert.equal(resharperConfig.projectPath, '/path/to/SampleApi.csproj');
  assert.equal(resharperConfig.launchConfigurationId, 'TargetFramework=net8.0;http');
  assert.equal(resharperConfig.noDebug, false);
  assert.deepEqual(resharperConfig.args, ['--foo', 'bar']);
  assert.equal(resharperConfig.env.ASPNETCORE_ENVIRONMENT, 'Development');
  assert.equal(resharperConfig.dotnavRunId, 'run-1');
  assert.equal(resharperConfig.dotnavTargetId, 'target-1');
  assert.equal(resharperConfig.program, undefined);
  assert.equal(resharperConfig.cwd, undefined);

  const resharperConfigWithoutProgram = buildDebugConfiguration(
    mockProject,
    mockProfile,
    true,
    '',
    'run-1',
    'target-1'
  );
  assert.equal(resharperConfigWithoutProgram.program, undefined);

  detector.dispose();
  assert.equal(isReSharperActive(), false);
  assert.equal(getActiveEngineDetector(), undefined);
});

test('EngineDetector - buildDebugConfiguration generates coreclr for Microsoft C#', () => {
  const extensions: Record<string, any> = {
    [MS_CSHARP_EXTENSION_ID]: createMockExtension(MS_CSHARP_EXTENSION_ID, '2.45.0', true)
  };

  const detector = new EngineDetector({
    getExtension: id => extensions[id],
    onExtensionsChanged: () => ({ dispose: () => {} }),
    getPreference: () => 'microsoft'
  });

  assert.equal(isReSharperActive(), false);

  const mockProject: any = {
    name: 'SampleApi',
    path: '/path/to/SampleApi.csproj',
    directory: '/path/to',
    targetFrameworks: ['net8.0']
  };

  const mockProfile: any = {
    name: 'http',
    applicationUrl: 'http://localhost:5000',
    environmentVariables: {
      ASPNETCORE_ENVIRONMENT: 'Development'
    }
  };

  const msConfig = buildDebugConfiguration(
    mockProject,
    mockProfile,
    false, // run without debug
    '/path/to/bin/Debug/net8.0/SampleApi.dll',
    'run-2',
    'target-2'
  );

  assert.equal(msConfig.type, 'coreclr');
  assert.equal(msConfig.program, '/path/to/bin/Debug/net8.0/SampleApi.dll');
  assert.equal(msConfig.noDebug, true);
  assert.equal(msConfig.dotnavRunId, 'run-2');

  detector.dispose();
});

test('EngineDetector - buildDebugConfiguration formats launchConfigurationId cleanly', () => {
  const extensions: Record<string, any> = {
    [RESHARPER_EXTENSION_ID]: createMockExtension(RESHARPER_EXTENSION_ID, '2026.2.2', true)
  };

  const detector = new EngineDetector({
    getExtension: id => extensions[id],
    onExtensionsChanged: () => ({ dispose: () => {} }),
    getPreference: () => 'resharper'
  });

  const projectNoTfm: any = {
    name: 'NoTfmApi',
    path: '/path/to/NoTfmApi.csproj',
    directory: '/path/to',
    targetFrameworks: []
  };

  const configProfileOnly = buildDebugConfiguration(
    projectNoTfm,
    { name: 'CustomProfile' } as any,
    true,
    ''
  );
  assert.equal(configProfileOnly.launchConfigurationId, 'TargetFramework=;CustomProfile');

  const projectWithTfm: any = {
    name: 'TfmApi',
    path: '/path/to/TfmApi.csproj',
    directory: '/path/to',
    targetFrameworks: ['net8.0']
  };

  const configTfmOnly = buildDebugConfiguration(
    projectWithTfm,
    undefined,
    true,
    ''
  );
  assert.equal(configTfmOnly.launchConfigurationId, 'TargetFramework=net8.0;');

  const configWithoutSelection = buildDebugConfiguration(
    { ...projectNoTfm, name: 'DefaultApi' },
    undefined,
    true,
    ''
  );
  assert.equal(configWithoutSelection.launchConfigurationId, undefined);
  assert.equal(configWithoutSelection.args, undefined);
  assert.equal(configWithoutSelection.env, undefined);

  detector.dispose();
});
