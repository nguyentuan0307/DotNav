import * as vscode from 'vscode';

export type CSharpEngineType = 'microsoft' | 'resharper' | 'dual' | 'none';
export type ActiveCSharpEngine = 'microsoft' | 'resharper' | 'none';
export type CSharpEnginePreference = 'auto' | 'microsoft' | 'resharper';

export interface CSharpEngineInfo {
  readonly type: CSharpEngineType;
  readonly activeEngine: ActiveCSharpEngine;
  readonly preference: CSharpEnginePreference;
  readonly hasMicrosoftCSharp: boolean;
  readonly hasCsDevKit: boolean;
  readonly hasReSharper: boolean;
  readonly hasCoreClrDebugger: boolean;
  readonly microsoftVersion?: string;
  readonly csDevKitVersion?: string;
  readonly resharperVersion?: string;
  readonly activeVersion?: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly statusText: string;
  readonly tooltip: string;
}

export interface EngineDetectorDependencies {
  readonly getExtension?: (id: string) => vscode.Extension<any> | undefined;
  readonly onExtensionsChanged?: vscode.Event<void>;
  readonly getPreference?: () => CSharpEnginePreference;
  readonly setPreference?: (preference: CSharpEnginePreference) => Thenable<void>;
  readonly onConfigChanged?: vscode.Event<vscode.ConfigurationChangeEvent>;
  readonly setContext?: (key: string, value: unknown) => Thenable<void>;
}

export const MS_CSHARP_EXTENSION_ID = 'ms-dotnettools.csharp';
export const MS_CSDEVKIT_EXTENSION_ID = 'ms-dotnettools.csdevkit';
export const RESHARPER_EXTENSION_ID = 'jetbrains.resharper-code';

let activeDetector: EngineDetector | undefined;
let reSharperReady = false;

export function getActiveEngineDetector(): EngineDetector | undefined {
  return activeDetector;
}

export function isReSharperActive(): boolean {
  return activeDetector?.currentInfo.activeEngine === 'resharper';
}

export function isReSharperBuildEnabled(): boolean {
  return isReSharperActive() && vscode.workspace
    .getConfiguration('dotnav.resharper')
    .get<boolean>('useReSharperBuild', true);
}

export function setReSharperReady(ready: boolean): void {
  reSharperReady = ready;
  void vscode.commands.executeCommand('setContext', 'dotnav.isReSharperReady', ready && isReSharperActive());
}

export class EngineDetector implements vscode.Disposable {
  private readonly _onDidChangeEngine = new vscode.EventEmitter<CSharpEngineInfo>();
  public readonly onDidChangeEngine: vscode.Event<CSharpEngineInfo> = this._onDidChangeEngine.event;

  private _currentInfo: CSharpEngineInfo;
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _deps: EngineDetectorDependencies;

  constructor(deps?: EngineDetectorDependencies) {
    this._deps = deps ?? {};
    activeDetector = this;
    this._currentInfo = this.detect();
    this.applyContextKeys(this._currentInfo);

    const onExtensionsChanged = this._deps.onExtensionsChanged ?? vscode.extensions.onDidChange;
    this._disposables.push(
      onExtensionsChanged(() => {
        this.refresh();
      })
    );

    const onConfigChanged = this._deps.onConfigChanged ?? vscode.workspace.onDidChangeConfiguration;
    this._disposables.push(
      onConfigChanged(e => {
        if (e.affectsConfiguration('dotnav.csharpEngine.preferred')
          || e.affectsConfiguration('dotnav.resharper.useReSharperBuild')) {
          this.refresh();
        }
      })
    );
  }

  public get currentInfo(): CSharpEngineInfo {
    return this._currentInfo;
  }

  public refresh(): CSharpEngineInfo {
    const updated = this.detect();
    this._currentInfo = updated;
    this.applyContextKeys(updated);
    this._onDidChangeEngine.fire(updated);
    return updated;
  }

  public detect(): CSharpEngineInfo {
    const getExt = this._deps.getExtension ?? (id => vscode.extensions.getExtension(id));
    const msCSharp = getExt(MS_CSHARP_EXTENSION_ID);
    const msDevKit = getExt(MS_CSDEVKIT_EXTENSION_ID);
    const resharper = getExt(RESHARPER_EXTENSION_ID);

    const hasMsCSharp = Boolean(msCSharp);
    const hasMsDevKit = Boolean(msDevKit);
    const hasMicrosoft = hasMsCSharp || hasMsDevKit;
    const hasReSharper = Boolean(resharper);

    let type: CSharpEngineType = 'none';
    if (hasMicrosoft && hasReSharper) {
      type = 'dual';
    } else if (hasReSharper) {
      type = 'resharper';
    } else if (hasMicrosoft) {
      type = 'microsoft';
    }

    const preference = this._deps.getPreference
      ? this._deps.getPreference()
      : vscode.workspace
          .getConfiguration('dotnav.csharpEngine')
          .get<CSharpEnginePreference>('preferred', 'auto');

    let activeEngine: ActiveCSharpEngine = 'none';
    if (type === 'none') {
      activeEngine = 'none';
    } else if (type === 'resharper') {
      activeEngine = 'resharper';
    } else if (type === 'microsoft') {
      activeEngine = 'microsoft';
    } else {
      // dual stack
      if (preference === 'resharper') {
        activeEngine = 'resharper';
      } else if (preference === 'microsoft') {
        activeEngine = 'microsoft';
      } else {
        // 'auto': prioritize ReSharper when detected so all tools migrate to it
        activeEngine = hasReSharper ? 'resharper' : (hasMsDevKit || hasMsCSharp ? 'microsoft' : 'none');
      }
    }

    const msVersion = msDevKit?.packageJSON?.version ?? msCSharp?.packageJSON?.version;
    const resharperVersion = resharper?.packageJSON?.version;
    const activeVersion = activeEngine === 'resharper' ? resharperVersion : msVersion;
    const hasCoreClrDebugger = hasMicrosoft || hasReSharper;

    let label = 'No C# Engine';
    let shortLabel = 'No C#';
    let statusText = '$(warning) No C# Engine';

    if (activeEngine === 'resharper') {
      label = `JetBrains C# by ReSharper${resharperVersion ? ` (v${resharperVersion})` : ''}`;
      shortLabel = 'ReSharper';
      statusText = '$(symbol-namespace) ReSharper';
    } else if (activeEngine === 'microsoft') {
      const isDevKit = hasMsDevKit;
      label = isDevKit
        ? `Microsoft C# Dev Kit${msVersion ? ` (v${msVersion})` : ''}`
        : `Microsoft C#${msVersion ? ` (v${msVersion})` : ''}`;
      shortLabel = isDevKit ? 'C# Dev Kit' : 'Microsoft C#';
      statusText = `$(symbol-namespace) ${shortLabel}`;
    }

    const tooltipLines: string[] = [
      `DotNav C# Engine: ${label}`,
      `Engine Mode: ${preference === 'auto' ? 'Auto-detected' : `Preferred (${preference})`}`
    ];
    if (type === 'dual') {
      tooltipLines.push('Dual-Stack Active: Both Microsoft C# and JetBrains ReSharper installed.');
    }
    if (!hasCoreClrDebugger) {
      tooltipLines.push('Warning: No C# debugger detected. Debugging requires Microsoft C# or ReSharper.');
    }
    tooltipLines.push('Click to manage C# engines and preferences.');

    return {
      type,
      activeEngine,
      preference,
      hasMicrosoftCSharp: hasMicrosoft,
      hasCsDevKit: hasMsDevKit,
      hasReSharper,
      hasCoreClrDebugger,
      microsoftVersion: msVersion,
      csDevKitVersion: msDevKit?.packageJSON?.version,
      resharperVersion,
      activeVersion,
      label,
      shortLabel,
      statusText,
      tooltip: tooltipLines.join('\n')
    };
  }

  private applyContextKeys(info: CSharpEngineInfo): void {
    const setCtx = this._deps.setContext ?? ((key, val) => vscode.commands.executeCommand('setContext', key, val));
    void setCtx('dotnav.csharpEngine', info.type);
    void setCtx('dotnav.activeCSharpEngine', info.activeEngine);
    void setCtx('dotnav.hasCSharpEngine', info.hasCoreClrDebugger);
    void setCtx('dotnav.hasReSharper', info.hasReSharper);
    void setCtx('dotnav.hasMicrosoftCSharp', info.hasMicrosoftCSharp);
    void setCtx('dotnav.hasCsDevKit', info.hasCsDevKit);
    void setCtx('dotnav.isReSharperActive', info.activeEngine === 'resharper');
    void setCtx('dotnav.isReSharperReady', info.activeEngine === 'resharper' && reSharperReady);
    void setCtx('dotnav.useReSharperBuild', info.activeEngine === 'resharper' && vscode.workspace
      .getConfiguration('dotnav.resharper')
      .get<boolean>('useReSharperBuild', true));
    if (info.activeEngine !== 'resharper') {
      reSharperReady = false;
    }
  }

  public async showQuickPick(): Promise<void> {
    const info = this._currentInfo;
    interface EnginePickItem extends vscode.QuickPickItem {
      readonly action: () => Promise<void> | void;
    }

    const items: EnginePickItem[] = [];

    // Current status header
    items.push({
      label: info.label,
      description: info.type === 'dual' ? 'Dual-Stack active' : (info.activeEngine === 'none' ? 'Missing' : 'Active'),
      detail: `Mode: ${info.preference === 'auto' ? 'Auto-detect' : `Preference: ${info.preference}`}`,
      action: () => {}
    });

    // Preferences options
    items.push({
      label: '$(gear) Engine Preference: Auto (Detect automatically)',
      description: info.preference === 'auto' ? '(Current)' : '',
      detail: 'Automatically select the active C# engine based on installed extensions',
      action: async () => {
        await this.setPreference('auto');
        vscode.window.showInformationMessage('DotNav: C# engine preference set to Auto.');
      }
    });

    items.push({
      label: '$(gear) Engine Preference: JetBrains ReSharper',
      description: info.preference === 'resharper' ? '(Current)' : '',
      detail: 'Prefer JetBrains C# by ReSharper when available',
      action: async () => {
        await this.setPreference('resharper');
        vscode.window.showInformationMessage('DotNav: C# engine preference set to JetBrains ReSharper.');
      }
    });

    items.push({
      label: '$(gear) Engine Preference: Microsoft C# / C# Dev Kit',
      description: info.preference === 'microsoft' ? '(Current)' : '',
      detail: 'Prefer Microsoft C# Dev Kit / C# extension when available',
      action: async () => {
        await this.setPreference('microsoft');
        vscode.window.showInformationMessage('DotNav: C# engine preference set to Microsoft C#.');
      }
    });

    // Marketplace install actions if missing
    if (!info.hasReSharper) {
      items.push({
        label: '$(cloud-download) Install JetBrains C# by ReSharper',
        detail: 'Install jetbrains.resharper-code from Marketplace',
        action: async () => {
          await vscode.commands.executeCommand('workbench.extensions.installExtension', RESHARPER_EXTENSION_ID);
        }
      });
    }

    if (!info.hasMicrosoftCSharp) {
      items.push({
        label: '$(cloud-download) Install Microsoft C# Dev Kit',
        detail: 'Install ms-dotnettools.csdevkit from Marketplace',
        action: async () => {
          await vscode.commands.executeCommand('workbench.extensions.installExtension', MS_CSDEVKIT_EXTENSION_ID);
        }
      });
    }

    // ReSharper actions if installed
    if (info.hasReSharper) {
      items.push({
        label: '$(symbol-variable) ReSharper: Show Value Tracking',
        detail: 'Trace values and data flow with ReSharper',
        action: async () => {
          await vscode.commands.executeCommand('resharper.showValueTracking');
        }
      });

      items.push({
        label: '$(tools) ReSharper: Reset PSI Caches',
        detail: 'Invalidate and rebuild ReSharper PSI code caches',
        action: async () => {
          await vscode.commands.executeCommand('resharper.psi.caches.reset');
        }
      });

      items.push({
        label: '$(key) ReSharper: Manage .NET User Secrets',
        detail: 'Open and manage User Secrets for the project',
        action: async () => {
          await vscode.commands.executeCommand('resharper.solutionExplorer.userSecrets');
        }
      });

      items.push({
        label: '$(debug-disconnect) ReSharper: Attach Debugger',
        detail: 'Attach ReSharper debugger to a running .NET process',
        action: async () => {
          await vscode.commands.executeCommand('resharper.debugger.attach.coreclr');
        }
      });

      items.push({
        label: '$(refresh) ReSharper: Open Explorer to Reload',
        detail: 'Select the solution or project in ReSharper Solution Explorer, then run Reload',
        action: async () => {
          await vscode.commands.executeCommand('dotnav.resharper.openExplorerForReload');
        }
      });
    }

    const picked = await vscode.window.showQuickPick(items, {
      title: 'DotNav: C# Language & Debugger Engines',
      placeHolder: `Active: ${info.label}`
    });

    if (picked) {
      await picked.action();
    }
  }

  private async setPreference(preference: CSharpEnginePreference): Promise<void> {
    if (this._deps.setPreference) {
      await this._deps.setPreference(preference);
    } else {
      await vscode.workspace
        .getConfiguration('dotnav.csharpEngine')
        .update('preferred', preference, vscode.ConfigurationTarget.Global);
    }
    this.refresh();
  }

  public dispose(): void {
    if (activeDetector === this) {
      activeDetector = undefined;
    }
    this._onDidChangeEngine.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}
