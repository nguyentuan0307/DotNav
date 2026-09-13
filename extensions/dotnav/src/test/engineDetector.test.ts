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
  RESHARPER_EXTENSION_ID
} = require('../engineDetector') as typeof import('../engineDetector');

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

  // Default auto with both inactive -> resolves based on fallback
  assert.equal(detector.currentInfo.type, 'dual');
  assert.equal(detector.currentInfo.hasMicrosoftCSharp, true);
  assert.equal(detector.currentInfo.hasReSharper, true);

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
});
