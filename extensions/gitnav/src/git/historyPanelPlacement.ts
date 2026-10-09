import type * as vscode from 'vscode';
import { historyEditor } from './editorHistoryContext';

type HistorySide = 'left' | 'right' | 'beside';

export class HistoryPanelLocation {
  constructor(
    readonly tab: vscode.Tab,
    readonly side: HistorySide,
    readonly resource: vscode.Uri,
    readonly editors: readonly vscode.TextEditor[] = []
  ) {}
}

export function captureHistoryPanelLocation(
  resource: vscode.Uri | undefined,
  activeEditor: vscode.TextEditor | undefined,
  visibleEditors: readonly vscode.TextEditor[],
  tabGroups: vscode.TabGroups
): HistoryPanelLocation | undefined {
  const uri = resource ?? activeEditor?.document.uri;
  if (!uri) return undefined;
  const editor = historyEditor(resource, activeEditor, visibleEditors);
  const groups = [...tabGroups.all].filter(group => {
    if (!editor || editor.viewColumn !== undefined) return true;
    // Embedded diff editors have no column, and floating-window active groups can be stale.
    // A different visible editor with a known column rules out that ordinary-file group.
    return !visibleEditors.some(candidate => candidate !== editor
      && candidate.viewColumn === group.viewColumn
      && candidate.document.uri.toString() === uri.toString());
  }).sort((a, b) =>
    Number(b.viewColumn === editor?.viewColumn) - Number(a.viewColumn === editor?.viewColumn)
    || Number(b === tabGroups.activeTabGroup) - Number(a === tabGroups.activeTabGroup));
  for (const group of groups) {
    const tab = group.activeTab;
    if (!tab) continue;
    const input = tab.input as Partial<vscode.TabInputText & vscode.TabInputTextDiff> | undefined;
    const original = input?.original?.toString() === uri.toString();
    const modified = input?.modified?.toString() === uri.toString();
    if (original || modified) {
      const editors = visibleEditors.filter(candidate =>
        (candidate.viewColumn === undefined || candidate.viewColumn === group.viewColumn)
        && (candidate.document.uri.toString() === input?.original?.toString()
          || candidate.document.uri.toString() === input?.modified?.toString()));
      return new HistoryPanelLocation(tab, original && !modified ? 'left' : 'right', uri, editors);
    }
    if (input?.uri?.toString() === uri.toString()) {
      return new HistoryPanelLocation(tab, 'beside', uri, editor ? [editor] : []);
    }
  }
  return undefined;
}

interface EditorLayoutGroup {
  readonly size?: number;
  readonly groups?: readonly EditorLayoutGroup[];
}

interface EditorLayout {
  readonly orientation: number;
  readonly groups: readonly EditorLayoutGroup[];
}

class EditorGroupBounds {
  constructor(
    readonly group: vscode.TabGroup,
    readonly left: number,
    readonly top: number,
    readonly width: number,
    readonly height: number
  ) {}
}

function groupBounds(layout: EditorLayout, groups: readonly vscode.TabGroup[]): EditorGroupBounds[] {
  const bounds: EditorGroupBounds[] = [];
  let column = 1;
  function visit(nodes: readonly EditorLayoutGroup[], horizontal: boolean, left: number, top: number, width: number, height: number): void {
    const total = nodes.reduce((sum, node) => sum + (node.size ?? 1), 0);
    let offset = 0;
    for (const node of nodes) {
      const fraction = (node.size ?? 1) / total;
      const x = left + (horizontal ? width * offset : 0);
      const y = top + (horizontal ? 0 : height * offset);
      const w = horizontal ? width * fraction : width;
      const h = horizontal ? height : height * fraction;
      if (node.groups?.length) visit(node.groups, !horizontal, x, y, w, h);
      else {
        const group = groups.find(candidate => candidate.viewColumn === column);
        column += 1;
        if (group) bounds.push(new EditorGroupBounds(group, x, y, w, h));
      }
      offset += fraction;
    }
  }
  visit(layout.groups, layout.orientation === 0, 0, 0, 1, 1);
  return bounds;
}

function isHistoryTab(tab: vscode.Tab): boolean {
  const input = tab.input as Partial<vscode.TabInputWebview> | undefined;
  return input?.viewType === 'gitnav.lineHistory' || input?.viewType === 'mainThreadWebview-gitnav.lineHistory';
}

export class HistoryPanelPlacement {
  private readonly ownedGroups = new Set<vscode.TabGroup>();

  constructor(
    private readonly tabGroups: vscode.TabGroups,
    private readonly executeCommand: <T = unknown>(command: string) => Thenable<T>,
    private readonly getActiveEditor?: () => vscode.TextEditor | undefined
  ) {}

  async show(location: HistoryPanelLocation | undefined, showAtColumn: (column: vscode.ViewColumn) => void): Promise<void> {
    await this.cleanupEmptyGroups();
    const source = location?.tab.group;
    if (location && (!this.tabGroups.all.includes(source!) || !source!.tabs.includes(location.tab))) {
      throw new Error('The source editor was closed. Reopen it before viewing history.');
    }
    if (!location || location.side === 'beside') {
      if (source) await this.focusGroup(source);
      if (location) this.ensureSourceFocused(location);
      showAtColumn(-2);
      return;
    }

    await this.focusGroup(source!);
    this.ensureSourceFocused(location);
    const layout = await this.executeCommand<EditorLayout>('vscode.getEditorLayout');
    if (!this.tabGroups.all.includes(source!) || !source!.tabs.includes(location.tab)) {
      throw new Error('The source editor was closed. Reopen it before viewing history.');
    }
    this.ensureSourceFocused(location);
    const bounds = groupBounds(layout, this.tabGroups.all);
    // Layout is part-local; ViewColumns include floating windows. Create beside the source
    // instead of reusing geometry when the layout does not cover every global group.
    const sourceBounds = bounds.length === this.tabGroups.all.length ? bounds.find(bound => bound.group === source) : undefined;
    const center = sourceBounds ? sourceBounds.top + sourceBounds.height / 2 : 0;
    const adjacent = sourceBounds && bounds.find(bound => bound.group !== source
      && center >= bound.top && center < bound.top + bound.height
      && Math.abs(location.side === 'left'
        ? bound.left + bound.width - sourceBounds.left
        : bound.left - sourceBounds.left - sourceBounds.width) < 0.000001)?.group;

    let destination = adjacent?.tabs.some(isHistoryTab) || adjacent?.tabs.length === 0 ? adjacent : undefined;
    if (!destination) {
      await this.focusGroup(source!);
      this.ensureSourceFocused(location);
      const before = new Set(this.tabGroups.all);
      await this.waitForState(() => this.tabGroups.all.some(group => !before.has(group)),
        () => this.executeCommand(`workbench.action.newGroup${location.side === 'left' ? 'Left' : 'Right'}`));
      destination = this.tabGroups.all.find(group => !before.has(group));
      if (!destination) throw new Error('Could not create a History editor group.');
      this.ownedGroups.add(destination);
    }

    try {
      const target = destination;
      await this.waitForState(() => target.tabs.some(isHistoryTab), () => showAtColumn(target.viewColumn));
    } finally {
      await this.cleanupEmptyGroups();
    }
  }

  async panelClosed(): Promise<void> {
    await this.waitForState(() => !this.tabGroups.all.some(group => group.tabs.some(isHistoryTab)), () => undefined);
    await this.cleanupEmptyGroups();
  }

  async cleanupEmptyGroups(): Promise<void> {
    for (const group of this.ownedGroups) {
      if (!this.tabGroups.all.includes(group)) this.ownedGroups.delete(group);
      else if (group.tabs.length === 0) {
        await this.tabGroups.close(group, true);
        this.ownedGroups.delete(group);
      }
    }
  }

  private async focusGroup(group: vscode.TabGroup): Promise<void> {
    // TabGroups can retain an old active group after an editor moves to another window.
    // Target global group order directly, without requiring a focus DTO event.
    const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];
    const ordinal = ordinals[group.viewColumn - 1];
    await this.executeCommand(`workbench.action.focus${ordinal ?? 'Last'}EditorGroup`);
    if (!ordinal) {
      const distance = this.tabGroups.all.length - group.viewColumn;
      for (let step = 0; step < distance; step++) {
        await this.executeCommand('workbench.action.focusPreviousGroup');
      }
    }
  }

  private ensureSourceFocused(location: HistoryPanelLocation): void {
    // Group focus does not always activate another native window. Never split its current window instead.
    if (this.getActiveEditor && location.editors.length > 0
      && !location.editors.includes(this.getActiveEditor()!)) {
      throw new Error('Focus the source editor window and run History again.');
    }
  }

  private waitForState(predicate: () => boolean, action: () => Thenable<unknown> | void): Promise<void> {
    return new Promise((resolve, reject) => {
      let actionDone = false;
      let finished = false;
      const subscriptions: vscode.Disposable[] = [];
      const finish = (error?: unknown) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        subscriptions.forEach(subscription => subscription.dispose());
        if (error) reject(error);
        else resolve();
      };
      const check = () => { if (actionDone && predicate()) finish(); };
      const timer = setTimeout(() => finish(new Error('History editor layout did not update. Try again.')), 3000);
      subscriptions.push(this.tabGroups.onDidChangeTabGroups(check), this.tabGroups.onDidChangeTabs(check));
      Promise.resolve().then(action).then(() => { actionDone = true; check(); }, finish);
    });
  }
}
