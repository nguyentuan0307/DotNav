import * as path from 'path';
import * as vscode from 'vscode';
import { createLocalHistoryPatch, LocalHistoryPatchHunk } from './localHistoryDiff';
import { renderLocalHistoryPanelHtml } from './localHistoryPanelHtml';
import { LocalHistoryPanelEntry } from './localHistoryQuery';
import { LocalHistoryService } from './localHistoryService';

interface SelectRevisionMessage {
  readonly type: 'selectRevision';
  readonly revisionId: string;
}

export class LocalHistoryPanel {
  private static current: LocalHistoryPanel | undefined;
  private entries: readonly LocalHistoryPanelEntry[] = [];
  private service: LocalHistoryService | undefined;
  private filePath = '';
  private generation = 0;

  static show(
    service: LocalHistoryService,
    filePath: string,
    entries: readonly LocalHistoryPanelEntry[],
    scopeLabel: string
  ): void {
    if (!LocalHistoryPanel.current) {
      LocalHistoryPanel.current = new LocalHistoryPanel();
    }
    LocalHistoryPanel.current.update(service, filePath, entries, scopeLabel);
  }

  private readonly panel: vscode.WebviewPanel;

  private constructor() {
    this.panel = vscode.window.createWebviewPanel(
      'dotnav.localHistory',
      'Local History',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.panel.onDidDispose(() => {
      LocalHistoryPanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage(message => {
      if (isSelectRevisionMessage(message)) {
        void this.loadRevision(message.revisionId);
      }
    });
  }

  private update(
    service: LocalHistoryService,
    filePath: string,
    entries: readonly LocalHistoryPanelEntry[],
    scopeLabel: string
  ): void {
    this.service = service;
    this.filePath = filePath;
    this.entries = entries;
    this.generation += 1;
    this.panel.title = `Local History — ${path.basename(filePath)}`;
    this.panel.webview.html = renderLocalHistoryPanelHtml({
      fileName: path.basename(filePath),
      filePath,
      scopeLabel,
      revisions: entries.map(entry => ({
        id: entry.revision.event.id,
        timestamp: entry.revision.event.timestamp,
        source: entry.revision.event.source,
        path: entry.revision.displayPath
      }))
    }, createNonce());
    this.panel.reveal(vscode.ViewColumn.Beside, false);
  }

  private async loadRevision(revisionId: string): Promise<void> {
    const generation = this.generation;
    const entry = this.entries.find(candidate => candidate.revision.event.id === revisionId);
    const revision = entry?.revision;
    const service = this.service;
    if (!revision || !service) {
      return;
    }

    try {
      const patch = entry.hunks ?? await createPatch(service, entry);
      if (generation !== this.generation) {
        return;
      }
      const limitedPatch = limitPatchLines(patch, 5000);
      await this.panel.webview.postMessage({
        type: 'revisionLoaded',
        revisionId,
        entry: {
          title: sourceTitle(revision.event.source),
          meta: `${new Date(revision.event.timestamp).toLocaleString()} · ${revision.displayPath}${limitedPatch.truncated ? ' · Diff truncated to 5,000 lines' : ''}`,
          hunks: limitedPatch.hunks
        }
      });
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      await this.panel.webview.postMessage({
        type: 'revisionError',
        revisionId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

function limitPatchLines(
  hunks: readonly LocalHistoryPatchHunk[],
  maximumLines: number
): { hunks: LocalHistoryPatchHunk[]; truncated: boolean } {
  const retained: LocalHistoryPatchHunk[] = [];
  let lineCount = 0;
  for (const hunk of hunks) {
    if (lineCount + hunk.lines.length > maximumLines) {
      const remaining = maximumLines - lineCount;
      if (remaining > 0) {
        retained.push({ ...hunk, lines: hunk.lines.slice(0, remaining) });
      }
      return { hunks: retained, truncated: true };
    }
    retained.push(hunk);
    lineCount += hunk.lines.length;
  }
  return { hunks: retained, truncated: false };
}

function isSelectRevisionMessage(value: unknown): value is SelectRevisionMessage {
  return Boolean(value && typeof value === 'object'
    && 'type' in value && value.type === 'selectRevision'
    && 'revisionId' in value && typeof value.revisionId === 'string');
}

function sourceTitle(source: string): string {
  switch (source) {
    case 'baseline': return 'Opened snapshot';
    case 'save': return 'Saved changes';
    case 'external': return 'External change';
    case 'command': return 'DotNav file operation';
    case 'manual': return 'Current editor state';
    case 'restore': return 'Restored revision';
    default: return 'Local change';
  }
}

async function createPatch(
  service: LocalHistoryService,
  entry: LocalHistoryPanelEntry
): Promise<readonly LocalHistoryPatchHunk[]> {
  const [revisionContent, previousContent] = await Promise.all([
    service.readRevision(entry.revision),
    entry.previousRevision ? service.readRevision(entry.previousRevision) : Promise.resolve('')
  ]);
  return createLocalHistoryPatch(previousContent, revisionContent);
}

function createNonce(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index++) {
    nonce += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return nonce;
}
