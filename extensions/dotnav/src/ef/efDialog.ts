import * as vscode from 'vscode';
import {
  EfDialogOption,
  EfDialogSpec,
  EfDialogValues,
  defaultValues,
  renderDialogHtml
} from './efDialogHtml';

export { EfDialogField, EfDialogOption, EfDialogSpec, EfDialogValues } from './efDialogHtml';

/** Host-side handle passed to callbacks so they can drive the open dialog. */
export interface EfDialogHandle {
  setPreview(text: string): void;
  setStatus(text: string, error?: boolean): void;
  setBusy(busy: boolean): void;
  setOptions(field: string, options: readonly EfDialogOption[], selected?: string): void;
}

export interface EfDialogCallbacks {
  /** Command-line preview shown at the bottom, recomputed on every edit. */
  readonly preview: (values: EfDialogValues) => string;
  readonly onChange?: (values: EfDialogValues, handle: EfDialogHandle) => void | Promise<void>;
  readonly onAction?: (action: string, values: EfDialogValues, handle: EfDialogHandle) => void | Promise<void>;
}

/**
 * Shows a Rider-style single-form dialog as a webview panel and resolves with
 * the submitted values, or undefined when dismissed. The dialog opens
 * instantly: every option it displays comes from the static source model, so
 * no `dotnet ef` build is on the path to showing UI.
 */
/** At most one EF dialog at a time; a second request replaces the first. */
let openDialog: { panel: vscode.WebviewPanel; dismiss: () => void } | undefined;

export function showEfDialog(
  spec: EfDialogSpec,
  callbacks: EfDialogCallbacks
): Promise<EfDialogValues | undefined> {
  // Reuse the tab instead of stacking one editor per invocation.
  openDialog?.dismiss();

  const panel = vscode.window.createWebviewPanel(
    'dotnav.efDialog',
    spec.title,
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const nonce = createNonce();
  panel.webview.html = renderDialogHtml(spec, nonce, panel.webview.cspSource);

  const handle: EfDialogHandle = {
    setPreview: text => void panel.webview.postMessage({ type: 'preview', text }),
    setStatus: (text, error) => void panel.webview.postMessage({ type: 'status', text, error }),
    setBusy: busy => void panel.webview.postMessage({ type: 'busy', busy }),
    setOptions: (field, options, selected) =>
      void panel.webview.postMessage({ type: 'options', field, options, selected })
  };

  return new Promise<EfDialogValues | undefined>(resolve => {
    let settled = false;
    const finish = (result: EfDialogValues | undefined) => {
      if (settled) {
        return;
      }

      settled = true;
      if (openDialog?.panel === panel) {
        openDialog = undefined;
      }

      resolve(result);
      panel.dispose();
    };

    openDialog = { panel, dismiss: () => finish(undefined) };

    const messageSubscription = panel.webview.onDidReceiveMessage(async (message: {
      type: string;
      values?: EfDialogValues;
      action?: string;
    }) => {
      const values = message.values ?? defaultValues(spec.fields);
      switch (message.type) {
        case 'ready':
        case 'change':
          handle.setPreview(callbacks.preview(values));
          await callbacks.onChange?.(values, handle);
          break;
        case 'action':
          if (message.action) {
            await callbacks.onAction?.(message.action, values, handle);
          }
          break;
        case 'submit':
          finish(values);
          break;
        case 'cancel':
          finish(undefined);
          break;
      }
    });

    panel.onDidDispose(() => {
      messageSubscription.dispose();
      finish(undefined);
    });
  });
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }

  return nonce;
}
