import * as path from 'path';
import * as vscode from 'vscode';
import { TreeNode } from '../models';
import { LocalHistoryPanel } from './localHistoryPanel';
import {
  buildFileHistoryEntries,
  buildSelectionHistoryEntries,
  LocalHistoryLineRange
} from './localHistoryQuery';
import { LocalHistoryService } from './localHistoryService';

export async function showFileLocalHistory(
  service: LocalHistoryService,
  node?: TreeNode
): Promise<void> {
  await runHistoryCommand(async () => {
    const filePath = resolveFilePath(node);
    if (!filePath) {
      vscode.window.showInformationMessage('Open or select a file before showing Local History.');
      return;
    }

    await captureCurrentState(service, filePath);
    const entries = buildFileHistoryEntries(await service.getRevisions(filePath));
    if (entries.length === 0) {
      vscode.window.showInformationMessage(`No content changes are available for ${path.basename(filePath)} yet.`);
      return;
    }
    LocalHistoryPanel.show(service, filePath, entries, 'File history');
  });
}

export async function showSelectionLocalHistory(service: LocalHistoryService): Promise<void> {
  await runHistoryCommand(async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file' || editor.selection.isEmpty) {
      vscode.window.showInformationMessage('Open a file and select a code range before showing Selection Local History.');
      return;
    }

    const filePath = editor.document.uri.fsPath;
    const selectedRange = selectedLineRange(editor.selection);
    await service.captureDocument(editor.document, 'manual');
    const revisions = await service.getRevisions(filePath);
    const entries = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: 'Filtering Local History for selection'
    }, () => buildSelectionHistoryEntries(
      revisions,
      selectedRange,
      revision => service.readRevision(revision)
    ));
    if (entries.length === 0) {
      vscode.window.showInformationMessage('No Local History revisions affect the selected lines.');
      return;
    }
    LocalHistoryPanel.show(
      service,
      filePath,
      entries,
      `Selection lines ${selectedRange.startLine}–${selectedRange.endLine}`
    );
  });
}

function selectedLineRange(selection: vscode.Selection): LocalHistoryLineRange {
  const startLine = selection.start.line + 1;
  const endLine = selection.end.character === 0 && selection.end.line > selection.start.line
    ? selection.end.line
    : selection.end.line + 1;
  return { startLine, endLine: Math.max(startLine, endLine) };
}

async function captureCurrentState(service: LocalHistoryService, filePath: string): Promise<void> {
  const document = vscode.workspace.textDocuments.find(candidate =>
    candidate.uri.scheme === 'file' && samePath(candidate.uri.fsPath, filePath));
  if (document) {
    await service.captureDocument(document, 'manual');
  } else {
    await service.captureFile(filePath, 'manual');
  }
}

function resolveFilePath(node?: TreeNode): string | undefined {
  if (node?.kind === 'file' && node.resourcePath) {
    return node.resourcePath;
  }
  const editor = vscode.window.activeTextEditor;
  return editor?.document.uri.scheme === 'file' ? editor.document.uri.fsPath : undefined;
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

async function runHistoryCommand(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Unable to show Local History: ${message}`);
  }
}
