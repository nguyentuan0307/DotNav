import * as vscode from 'vscode';
import {
  EfDialogOption,
  EfDialogSpec,
  EfDialogValues,
  defaultValues,
  renderDialogHtml
} from './efDialogHtml';
import { EfLocale, localizeEfText } from './efDialogI18n';

export { EfDialogField, EfDialogOption, EfDialogSpec, EfDialogValues } from './efDialogHtml';

export type EfProgressStepState = 'pending' | 'active' | 'complete' | 'error';

export interface EfProgressStep {
  readonly label: string;
  readonly state: EfProgressStepState;
  readonly detail?: string;
}

export interface EfProgressUpdate {
  readonly title: string;
  readonly state: 'running' | 'success' | 'error' | 'cancelled';
  readonly steps: readonly EfProgressStep[];
}

/** Host-side handle passed to callbacks so they can drive the open dialog. */
export interface EfDialogHandle {
  setPreview(text: string): void;
  setStatus(text: string, error?: boolean): void;
  setBusy(busy: boolean): void;
  setValid(valid: boolean): void;
  setSubmit(label: string, danger?: boolean): void;
  setValue(field: string, value: string): void;
  setOptions(field: string, options: readonly EfDialogOption[], selected?: string): void;
  setProgress(progress: EfProgressUpdate | undefined): void;
}

export interface EfDialogCallbacks {
  /** Command-line preview shown at the bottom, recomputed on every edit. */
  readonly preview: (values: EfDialogValues) => string;
  readonly onChange?: (values: EfDialogValues, handle: EfDialogHandle) => void | Promise<void>;
  readonly onAction?: (action: string, values: EfDialogValues, handle: EfDialogHandle) => void | Promise<void>;
  /**
   * Runs the primary action without ending the Center session. When supplied,
   * the form remains live and can be submitted again after this callback
   * settles. Older callers may still use the one-shot promise result.
   */
  readonly onSubmit?: (values: EfDialogValues, handle: EfDialogHandle) => void | Promise<void>;
}

/**
 * Shows an action inside the persistent EF Core Center and resolves with the
 * submitted values, or undefined when dismissed/navigated away. The Center
 * opens instantly: every option it displays comes from the static source
 * model, so no `dotnet ef` build is on the path to showing UI.
 */
/** One persistent EF Core Center tab; actions replace its active form. */
let centerPanel: vscode.WebviewPanel | undefined;
let openDialog: { panel: vscode.WebviewPanel; dismiss: (disposePanel?: boolean) => void } | undefined;
let centerMessageSubscription: vscode.Disposable | undefined;
let centerPanelDisposeSubscription: vscode.Disposable | undefined;

interface EfCenterSession {
  readonly common: EfDialogValues;
  readonly actions: Map<string, EfDialogValues>;
}

const SESSION_COMMON_FIELDS = new Set([
  'project', 'startup', 'context', 'connection', 'configuration', 'noBuild', 'extraArgs'
]);
let centerSession: EfCenterSession | undefined;

function sessionForCenter(): EfCenterSession {
  centerSession ??= { common: {}, actions: new Map() };
  return centerSession;
}

function rememberSessionValues(actionId: string | undefined, values: EfDialogValues): void {
  const session = sessionForCenter();
  const actionValues = actionId ? { ...(session.actions.get(actionId) ?? {}) } : undefined;
  for (const [field, value] of Object.entries(values)) {
    if (SESSION_COMMON_FIELDS.has(field)) {
      session.common[field] = value;
    } else if (actionValues) {
      actionValues[field] = value;
    }
  }
  if (actionId && actionValues) {
    session.actions.set(actionId, actionValues);
  }
}

function prepareSessionForSpec(spec: EfDialogSpec): void {
  const defaults = defaultValues(spec.fields);
  const requestedProject = defaults['project'];
  const rememberedProject = centerSession?.common['project'];
  if (
    typeof requestedProject === 'string' && requestedProject.length > 0 &&
    typeof rememberedProject === 'string' && rememberedProject.length > 0 &&
    requestedProject !== rememberedProject
  ) {
    // A context-menu action for another project starts a distinct Center
    // session. Navigation inside the Center passes the current project and
    // therefore continues to preserve values.
    centerSession = undefined;
  }
}

function sessionValues(spec: EfDialogSpec): EfDialogValues {
  const defaults = defaultValues(spec.fields);
  const session = sessionForCenter();
  const remembered = spec.actionId ? session.actions.get(spec.actionId) : undefined;
  const values: EfDialogValues = { ...defaults };
  for (const field of spec.fields) {
    const value = remembered?.[field.id] ?? session.common[field.id];
    if (value !== undefined) {
      values[field.id] = value;
    }
  }
  return values;
}

function specWithValues(spec: EfDialogSpec, values: EfDialogValues): EfDialogSpec {
  return {
    ...spec,
    fields: spec.fields.map(field => ({
      ...field,
      value: values[field.id] ?? field.value
    }))
  };
}

export function setEfCenterBusy(busy: boolean, status?: string, error = false): void {
  if (!centerPanel) {
    return;
  }
  void centerPanel.webview.postMessage({ type: 'busy', busy });
  if (status !== undefined) {
    void centerPanel.webview.postMessage({ type: 'status', text: status, error });
  }
}

export function setEfCenterStatus(status: string, error = false): void {
  if (!centerPanel) {
    return;
  }
  void centerPanel.webview.postMessage({
    type: 'status',
    text: status,
    textVi: localizeEfText(status, 'vi'),
    error
  });
}

export function setEfCenterProgress(progress: EfProgressUpdate | undefined): void {
  if (!centerPanel) {
    return;
  }
  void centerPanel.webview.postMessage(progressMessage(progress));
}

function progressMessage(progress: EfProgressUpdate | undefined): object {
  return {
    type: 'progress',
    progress: progress
      ? {
        ...progress,
        titleVi: localizeProgressTitle(progress.title),
        steps: progress.steps.map(step => ({
          ...step,
          labelVi: localizeEfText(step.label, 'vi'),
          detailVi: step.detail ? localizeEfText(step.detail, 'vi') : undefined
        }))
      }
      : undefined
  };
}

function localizeProgressTitle(title: string): string {
  const adding = /^Adding migration '(.+)'$/.exec(title);
  if (adding) {
    return `Đang thêm migration '${adding[1]}'`;
  }
  const updating = /^Updating database to '(.+)'$/.exec(title);
  if (updating) {
    return `Đang cập nhật database tới '${updating[1]}'`;
  }
  return localizeEfText(title, 'vi');
}

export function disposeEfCenter(): void {
  openDialog?.dismiss(false);
  openDialog = undefined;
  centerMessageSubscription?.dispose();
  centerMessageSubscription = undefined;
  centerPanelDisposeSubscription?.dispose();
  centerPanelDisposeSubscription = undefined;
  centerPanel?.dispose();
  centerPanel = undefined;
  centerSession = undefined;
}

export function showEfDialog(
  spec: EfDialogSpec,
  callbacks: EfDialogCallbacks
): Promise<EfDialogValues | undefined> {
  // Reuse one editor tab so context-menu actions route into the same Center.
  const reusablePanel = centerPanel;
  openDialog?.dismiss(false);
  centerMessageSubscription?.dispose();
  centerPanelDisposeSubscription?.dispose();
  if (!reusablePanel) {
    centerSession = undefined;
  }
  const panel = reusablePanel ?? vscode.window.createWebviewPanel(
    'dotnav.efCenter',
    'EF Core Center',
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: false }
  );
  centerPanel = panel;
  panel.reveal(vscode.ViewColumn.Active, false);

  const nonce = createNonce();
  const initialLocale = resolveEfLocale();
  prepareSessionForSpec(spec);
  const initialValues = sessionValues(spec);
  rememberSessionValues(spec.actionId, initialValues);
  panel.webview.html = renderDialogHtml(
    specWithValues(spec, initialValues),
    nonce,
    panel.webview.cspSource,
    initialLocale
  );

  const handle: EfDialogHandle = {
    setPreview: text => void panel.webview.postMessage({ type: 'preview', text }),
    setStatus: (text, error) => void panel.webview.postMessage({
      type: 'status',
      text,
      textVi: localizeEfText(text, 'vi'),
      error
    }),
    setBusy: busy => void panel.webview.postMessage({ type: 'busy', busy }),
    setValid: valid => void panel.webview.postMessage({ type: 'validity', valid }),
    setSubmit: (label, danger) => void panel.webview.postMessage({
      type: 'submit',
      label,
      labelVi: localizeEfText(label, 'vi'),
      danger
    }),
    setValue: (field, value) => void panel.webview.postMessage({ type: 'value', field, value }),
    setOptions: (field, options, selected) =>
      void panel.webview.postMessage({ type: 'options', field, options, selected }),
    setProgress: progress => void panel.webview.postMessage(progressMessage(progress)),
  };

  return new Promise<EfDialogValues | undefined>(resolve => {
    let settled = false;
    let submitting = false;
    const finish = (result: EfDialogValues | undefined, disposePanel = true) => {
      if (settled) {
        return;
      }

      settled = true;
      if (openDialog?.panel === panel) {
        openDialog = undefined;
      }

      resolve(result);
      if (disposePanel) {
        centerMessageSubscription?.dispose();
        centerPanelDisposeSubscription?.dispose();
        centerPanel = undefined;
        panel.dispose();
      }
    };

    openDialog = { panel, dismiss: (disposePanel = true) => finish(undefined, disposePanel) };

    centerMessageSubscription = panel.webview.onDidReceiveMessage(async (message: {
      type: string;
      values?: EfDialogValues;
      action?: string;
      command?: string;
      text?: string;
      locale?: EfLocale;
    }) => {
      const values = message.values ?? sessionValues(spec);
      switch (message.type) {
        case 'ready': {
          if (settled) {
            return;
          }
          // The DOM may have been destroyed while hidden. Rehydrate from host
          // memory before accepting its initial/default values.
          const remembered = sessionValues(spec);
          void panel.webview.postMessage({ type: 'values', values: remembered });
          handle.setPreview(callbacks.preview(remembered));
          await callbacks.onChange?.(remembered, handle);
          break;
        }
        case 'change':
          if (settled) {
            return;
          }
          rememberSessionValues(spec.actionId, values);
          handle.setPreview(callbacks.preview(values));
          await callbacks.onChange?.(values, handle);
          break;
        case 'action':
          if (settled) {
            return;
          }
          if (message.action) {
            rememberSessionValues(spec.actionId, values);
            await callbacks.onAction?.(message.action, values, handle);
          }
          break;
        case 'submit':
          if (settled || submitting) {
            return;
          }
          handle.setBusy(true);
          handle.setStatus('Running command…');
          rememberSessionValues(spec.actionId, values);
          if (callbacks.onSubmit) {
            submitting = true;
            try {
              await callbacks.onSubmit(values, handle);
            } catch {
              // Unexpected exceptions can contain process arguments. Keep the
              // Center status generic so a connection string is never echoed.
              handle.setStatus('Command failed unexpectedly. See the notification or Output for details.', true);
            } finally {
              submitting = false;
              if (!settled) {
                handle.setBusy(false);
              }
            }
          } else {
            finish(values, false);
          }
          break;
        case 'cancel':
          if (settled) {
            centerPanel = undefined;
            centerMessageSubscription?.dispose();
            centerPanelDisposeSubscription?.dispose();
            panel.dispose();
          } else {
            finish(undefined);
          }
          break;
        case 'copy':
          await vscode.env.clipboard.writeText(message.text ?? '');
          handle.setStatus('Generated command copied to the clipboard.');
          break;
        case 'locale':
          if (message.locale === 'en' || message.locale === 'vi') {
            await vscode.workspace.getConfiguration('dotnav.ef')
              .update('language', message.locale, vscode.ConfigurationTarget.Global);
          }
          break;
        case 'navigate': {
          const command = message.command;
          const projectPath = String(values['project'] ?? '');
          finish(undefined, false);
          if (command?.startsWith('dotnav.ef.')) {
            await vscode.commands.executeCommand(command, projectPath);
          }
          break;
        }
        case 'toolbar': {
          const projectPath = String(values['project'] ?? '');
          const commands: Record<string, string> = {
            refresh: 'dotnav.ef.refresh',
            output: 'dotnav.ef.showOutput',
            tool: 'dotnav.ef.installTool',
            settings: 'dotnav.ef.openSettings'
          };
          const command = message.action ? commands[message.action] : undefined;
          if (command) {
            await vscode.commands.executeCommand(command, projectPath);
            if ((message.action === 'refresh' || message.action === 'tool') && spec.actionId) {
              finish(undefined, false);
              await vscode.commands.executeCommand(spec.actionId, projectPath);
            }
          }
          break;
        }
      }
    });

    centerPanelDisposeSubscription = panel.onDidDispose(() => {
      centerPanel = undefined;
      centerMessageSubscription?.dispose();
      centerPanelDisposeSubscription = undefined;
      centerSession = undefined;
      finish(undefined, false);
    });
  });
}

function resolveEfLocale(): EfLocale {
  const configured = vscode.workspace.getConfiguration('dotnav.ef')
    .get<'auto' | EfLocale>('language', 'auto');
  if (configured === 'en' || configured === 'vi') {
    return configured;
  }

  return vscode.env.language.toLowerCase().startsWith('vi') ? 'vi' : 'en';
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }

  return nonce;
}
