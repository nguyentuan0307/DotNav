import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'node:module';
import type * as vscode from 'vscode';
import { captureHistoryPanelLocation, HistoryPanelLocation, HistoryPanelPlacement } from '../git/historyPanelPlacement';

function uri(value: string): vscode.Uri {
  return { toString: () => value, with: () => uri(value) } as unknown as vscode.Uri;
}

class FakeTab implements vscode.Tab {
  readonly isDirty = false;
  readonly isPinned = false;
  readonly isPreview = false;
  constructor(public group: FakeGroup, readonly input: unknown, readonly label: string) {}
  get isActive(): boolean { return this.group.activeTab === this; }
}

class FakeGroup implements vscode.TabGroup {
  readonly tabs: FakeTab[] = [];
  constructor(readonly owner: FakeTabGroups) {}
  get viewColumn(): vscode.ViewColumn { return this.owner.all.indexOf(this) + 1; }
  get isActive(): boolean { return this.owner.activeTabGroup === this; }
  get activeTab(): FakeTab | undefined { return this.tabs[0]; }
}

class FakeTabGroups implements vscode.TabGroups {
  readonly all: FakeGroup[] = [];
  activeTabGroup!: FakeGroup;
  commandActiveGroup: FakeGroup | undefined;
  staleFocusState = false;
  readonly commands: string[] = [];
  readonly closedGroups: FakeGroup[] = [];
  readonly listeners = new Set<() => void>();
  historyTab: FakeTab | undefined;
  layout: { orientation: number; groups: { groups?: {}[] }[] } | undefined;

  readonly onDidChangeTabGroups: vscode.Event<vscode.TabGroupChangeEvent> = listener =>
    this.listen(() => listener({ opened: [], closed: [], changed: this.all }));
  readonly onDidChangeTabs: vscode.Event<vscode.TabChangeEvent> = listener =>
    this.listen(() => listener({ opened: [], closed: [], changed: this.all.flatMap(group => group.tabs) }));

  private listen(listener: () => void): vscode.Disposable {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }

  changed(): void { [...this.listeners].forEach(listener => listener()); }

  add(input?: unknown, label = 'unrelated'): FakeGroup {
    const group = new FakeGroup(this);
    if (input) group.tabs.push(new FakeTab(group, input, label));
    this.all.push(group);
    this.activeTabGroup = group;
    this.commandActiveGroup = group;
    return group;
  }

  async close(value: vscode.Tab | vscode.TabGroup | readonly (vscode.Tab | vscode.TabGroup)[]): Promise<boolean> {
    const groups = Array.isArray(value) ? value : [value];
    for (const group of groups) {
      assert.ok(group instanceof FakeGroup);
      assert.equal(group.tabs.length, 0, 'never close a group containing a user tab');
      this.all.splice(this.all.indexOf(group), 1);
      this.closedGroups.push(group);
    }
    this.changed();
    return true;
  }

  execute = async <T = unknown>(command: string): Promise<T> => {
    this.commands.push(command);
    if (command === 'vscode.getEditorLayout') {
      return (this.layout ?? { orientation: 0, groups: this.all.map(() => ({})) }) as T;
    }
    const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];
    const ordinal = ordinals.findIndex(value => command === `workbench.action.focus${value}EditorGroup`);
    if (ordinal >= 0 || command === 'workbench.action.focusLastEditorGroup' || command === 'workbench.action.focusPreviousGroup') {
      const index = ordinal >= 0 ? ordinal : command.endsWith('LastEditorGroup')
        ? this.all.length - 1 : this.all.indexOf(this.commandActiveGroup ?? this.activeTabGroup) - 1;
      this.commandActiveGroup = this.all[index];
      if (this.staleFocusState) return undefined as T;
      this.activeTabGroup = this.commandActiveGroup;
    } else {
      assert.ok(command === 'workbench.action.newGroupLeft' || command === 'workbench.action.newGroupRight', command);
      const index = this.all.indexOf(this.commandActiveGroup ?? this.activeTabGroup) + (command.endsWith('Right') ? 1 : 0);
      const group = new FakeGroup(this);
      this.all.splice(index, 0, group);
      this.activeTabGroup = group;
      this.commandActiveGroup = group;
    }
    this.changed();
    return undefined as T;
  };

  showHistory = (column: vscode.ViewColumn): void => {
    let target = column === -2 ? this.all[this.all.indexOf(this.activeTabGroup) + 1] : this.all[column - 1];
    if (!target) target = this.add();
    if (this.historyTab) {
      const previous = this.historyTab.group;
      previous.tabs.splice(previous.tabs.indexOf(this.historyTab), 1);
      this.historyTab.group = target;
    } else this.historyTab = new FakeTab(target, { viewType: 'mainThreadWebview-gitnav.lineHistory' }, 'History');
    target.tabs.unshift(this.historyTab);
    this.activeTabGroup = target;
    this.commandActiveGroup = target;
    // Simulate an IPC update after reveal. Empty groups remain until explicitly closed.
    queueMicrotask(() => this.changed());
  };

  editor(resource: vscode.Uri, group: FakeGroup): vscode.TextEditor {
    return { document: { uri: resource }, viewColumn: group.viewColumn } as vscode.TextEditor;
  }
}

test('capture uses the clicked URI and owner group rather than the focused History panel or URI scheme', () => {
  const groups = new FakeTabGroups();
  const left = uri('gitnav-revision:/sample.ts?main');
  const right = uri('gitnav-revision:/sample.ts?feature');
  const diff = groups.add({ original: left, modified: right }, 'diff');
  const leftEditor = groups.editor(left, diff), rightEditor = groups.editor(right, diff);
  groups.add({ viewType: 'gitnav.lineHistory' }, 'History');
  assert.equal(captureHistoryPanelLocation(left, undefined, [leftEditor, rightEditor], groups)?.side, 'left');
  assert.equal(captureHistoryPanelLocation(right, leftEditor, [leftEditor, rightEditor], groups)?.side, 'right');
  assert.equal(captureHistoryPanelLocation(undefined, rightEditor, [leftEditor, rightEditor], groups)?.tab, diff.tabs[0]);
});

test('the focused ordinary file takes precedence over a diff containing the same file', () => {
  const groups = new FakeTabGroups();
  const left = uri('gitnav-compare:/sample.ts'), right = uri('file:/repo/sample.ts');
  groups.add({ original: left, modified: right }, 'diff');
  const ordinary = groups.add({ uri: right }, 'ordinary');
  const editor = groups.editor(right, ordinary);
  assert.equal(captureHistoryPanelLocation(undefined, editor, [editor], groups)?.side, 'beside');
  assert.equal(captureHistoryPanelLocation(undefined, undefined, [], groups), undefined);
});

test('a floating modified editor is not confused with a different visible ordinary editor for the same URI', () => {
  const groups = new FakeTabGroups();
  const left = uri('gitnav-compare:/sample.ts'), right = uri('file:/repo/sample.ts');
  const ordinary = groups.add({ uri: right }, 'ordinary');
  const diff = groups.add({ original: left, modified: right }, 'diff');
  const ordinaryEditor = groups.editor(right, ordinary);
  const diffEditor = { document: { uri: right }, viewColumn: undefined } as vscode.TextEditor;
  groups.activeTabGroup = ordinary;
  const visibleEditors = [ordinaryEditor, diffEditor];
  for (const resource of [right, undefined]) {
    const location = captureHistoryPanelLocation(resource, diffEditor, visibleEditors, groups);
    assert.equal(location?.tab, diff.tabs[0]);
    assert.equal(location?.side, 'right');
  }
  assert.equal(captureHistoryPanelLocation(undefined, ordinaryEditor, visibleEditors, groups)?.tab, ordinary.tabs[0]);
});

test('group focus that cannot activate the source native window reports a retry without opening History elsewhere', async () => {
  const groups = new FakeTabGroups();
  const left = uri('gitnav-compare:/sample.ts'), right = uri('file:/repo/sample.ts');
  const ordinary = groups.add({ uri: right }, 'ordinary');
  const diff = groups.add({ original: left, modified: right }, 'diff');
  const ordinaryEditor = groups.editor(right, ordinary);
  const diffEditor = { document: { uri: right }, viewColumn: undefined } as vscode.TextEditor;
  const location = captureHistoryPanelLocation(right, diffEditor, [ordinaryEditor, diffEditor], groups);
  let activeEditor: vscode.TextEditor = ordinaryEditor;
  const placement = new HistoryPanelPlacement(groups, groups.execute, () => activeEditor);
  await assert.rejects(placement.show(location, groups.showHistory), /Focus the source editor window/);
  assert.ok(!groups.historyTab);
  assert.ok(!groups.commands.some(command => command.startsWith('workbench.action.newGroup')));
  activeEditor = diffEditor;
  await placement.show(location, groups.showHistory);
  assert.equal(groups.historyTab!.group.viewColumn, diff.viewColumn + 1);
  assert.equal(groups.listeners.size, 0);
});

test('History switches sides of a middle diff without duplicates, unrelated tab changes or accumulated empty groups', async () => {
  const groups = new FakeTabGroups();
  const before = groups.add({ uri: uri('file:/before.ts') });
  const left = uri('gitnav-compare:/left'), right = uri('gitnav-compare:/right');
  const diff = groups.add({ original: left, modified: right }, 'diff');
  const after = groups.add({ uri: uri('file:/after.ts') });
  const placement = new HistoryPanelPlacement(groups, groups.execute);
  const sourceTab = diff.tabs[0];
  for (const side of ['left', 'left', 'right', 'right', 'left', 'right'] as const) {
    await placement.show(new HistoryPanelLocation(sourceTab, side, side === 'left' ? left : right), groups.showHistory);
    assert.equal(groups.all.length, 4);
    assert.equal(groups.all.indexOf(groups.historyTab!.group) - groups.all.indexOf(diff), side === 'left' ? -1 : 1);
    assert.deepEqual(groups.all.flatMap(group => group.tabs).map(tab => tab.label).sort(), ['History', 'diff', 'unrelated', 'unrelated']);
    assert.equal(diff.tabs[0], sourceTab);
    assert.equal(before.tabs.length, 1);
    assert.equal(after.tabs.length, 1);
  }
  assert.equal(groups.commands.filter(command => command.startsWith('workbench.action.newGroup')).length, 4);
  assert.equal(groups.listeners.size, 0);
});

test('placement stays anchored to the captured diff while another group is focused during loading', async () => {
  const groups = new FakeTabGroups();
  const left = uri('gitnav-compare:/left'), right = uri('file:/right');
  const diff = groups.add({ original: left, modified: right });
  const editor = groups.editor(left, diff);
  const location = captureHistoryPanelLocation(left, editor, [editor], groups);
  groups.add({ uri: uri('file:/elsewhere.ts') });
  const placement = new HistoryPanelPlacement(groups, groups.execute);
  await placement.show(location, groups.showHistory);
  assert.equal(groups.all[0], groups.historyTab!.group);
  assert.equal(groups.all[1], diff);
});

test('a History group below the diff is not mistaken for its right neighbor', async () => {
  const groups = new FakeTabGroups();
  const left = uri('gitnav-revision:/left'), right = uri('gitnav-revision:/right');
  const diff = groups.add({ original: left, modified: right });
  const below = groups.add();
  groups.showHistory(below.viewColumn);
  groups.layout = { orientation: 1, groups: [{}, {}] };
  const placement = new HistoryPanelPlacement(groups, groups.execute);
  await placement.show(new HistoryPanelLocation(diff.tabs[0], 'right', right), groups.showHistory);
  assert.ok(groups.commands.includes('workbench.action.newGroupRight'));
  assert.notEqual(groups.historyTab!.group, below);
  assert.ok(groups.all.includes(below), 'preserve an empty group created by the user');
});

test('nested editor layout resolves the diff column and reuses its horizontal History neighbor', async () => {
  const groups = new FakeTabGroups();
  groups.add({ uri: uri('file:/top-left') });
  groups.add({ uri: uri('file:/bottom-left') });
  const left = uri('gitnav-revision:/left'), right = uri('gitnav-revision:/right');
  const diff = groups.add({ original: left, modified: right });
  const history = groups.add();
  groups.showHistory(history.viewColumn);
  groups.layout = { orientation: 0, groups: [{ groups: [{}, {}] }, {}, {}] };
  const placement = new HistoryPanelPlacement(groups, groups.execute);
  await placement.show(new HistoryPanelLocation(diff.tabs[0], 'right', right), groups.showHistory);
  assert.equal(groups.historyTab!.group, history);
  assert.ok(!groups.commands.some(command => command.startsWith('workbench.action.newGroup')));
});

test('part-local floating window layouts create History beside the captured global source group', async () => {
  const groups = new FakeTabGroups();
  const mainWindow = groups.add({ uri: uri('file:/main-window') });
  groups.add({ uri: uri('file:/another-main-group') });
  const left = uri('gitnav-compare:/left'), right = uri('file:/right');
  const diff = groups.add({ original: left, modified: right });
  const sourceTab = diff.tabs[0];
  groups.layout = { orientation: 0, groups: [{}] };
  groups.activeTabGroup = mainWindow;
  const placement = new HistoryPanelPlacement(groups, groups.execute);
  for (const side of ['left', 'left', 'right'] as const) {
    await placement.show(new HistoryPanelLocation(sourceTab, side, side === 'left' ? left : right), groups.showHistory);
    assert.equal(groups.all.indexOf(groups.historyTab!.group) - groups.all.indexOf(diff), side === 'left' ? -1 : 1);
    assert.equal(groups.all.length, 4, 'no empty owned groups accumulate across window-local placements');
  }
  const layoutCommand = groups.commands.indexOf('vscode.getEditorLayout');
  assert.ok(groups.commands.slice(0, layoutCommand).includes('workbench.action.focusThirdEditorGroup'));
  assert.equal(mainWindow.tabs.length, 1);
  assert.equal(groups.listeners.size, 0);
});

test('floating source focus does not require the cached activeTabGroup to update or emit an event', async () => {
  const groups = new FakeTabGroups();
  const main = groups.add({ uri: uri('file:/main-window') });
  const left = uri('gitnav-compare:/left'), right = uri('file:/right');
  const diff = groups.add({ original: left, modified: right });
  groups.activeTabGroup = main;
  groups.commandActiveGroup = diff;
  groups.staleFocusState = true;
  groups.layout = { orientation: 0, groups: [{}] };
  const placement = new HistoryPanelPlacement(groups, groups.execute);
  await placement.show(new HistoryPanelLocation(diff.tabs[0], 'left', left), groups.showHistory);
  assert.equal(groups.historyTab!.group.viewColumn + 1, diff.viewColumn);
  assert.equal(main.tabs.length, 1);
  assert.ok(groups.commands.includes('workbench.action.focusSecondEditorGroup'));
  assert.equal(groups.listeners.size, 0);
});

test('source groups beyond the eighth column use global last and previous focus without replacing tabs', async () => {
  const groups = new FakeTabGroups();
  for (let index = 0; index < 8; index++) groups.add({ uri: uri(`file:/unrelated-${index}`) });
  const left = uri('gitnav-compare:/left'), right = uri('file:/right');
  const diff = groups.add({ original: left, modified: right }, 'diff');
  const sourceTab = diff.tabs[0];
  groups.add({ uri: uri('file:/unrelated-last') });
  const placement = new HistoryPanelPlacement(groups, groups.execute);
  for (const side of ['left', 'right'] as const) {
    await placement.show(new HistoryPanelLocation(sourceTab, side, side === 'left' ? left : right), groups.showHistory);
    assert.equal(groups.historyTab!.group.viewColumn - diff.viewColumn, side === 'left' ? -1 : 1);
    assert.equal(groups.all.length, 11);
    assert.equal(groups.all.flatMap(group => group.tabs).filter(tab => tab.label === 'unrelated').length, 9);
    assert.equal(diff.tabs[0], sourceTab);
  }
  assert.ok(groups.commands.includes('workbench.action.focusLastEditorGroup'));
  assert.ok(groups.commands.includes('workbench.action.focusPreviousGroup'));
  assert.equal(groups.listeners.size, 0);
});

test('a closed source is rejected and closing History only cleans up groups created by GitNav', async () => {
  const groups = new FakeTabGroups();
  const resource = uri('file:/ordinary');
  const ordinary = groups.add({ uri: resource });
  const ordinaryEditor = groups.editor(resource, ordinary);
  const ordinaryLocation = captureHistoryPanelLocation(resource, ordinaryEditor, [ordinaryEditor], groups);
  const placement = new HistoryPanelPlacement(groups, groups.execute);
  await placement.show(ordinaryLocation, column => { assert.equal(column, -2); groups.showHistory(column); });
  const left = uri('gitnav-compare:/left'), right = uri('file:/right');
  const diff = groups.add({ original: left, modified: right });
  const sourceTab = diff.tabs[0];
  await placement.show(new HistoryPanelLocation(sourceTab, 'right', right), groups.showHistory);
  const owned = groups.historyTab!.group;
  owned.tabs.length = 0;
  groups.historyTab = undefined;
  groups.changed();
  await placement.panelClosed();
  assert.ok(!groups.all.includes(owned));
  assert.ok(groups.all.includes(ordinary));
  diff.tabs.length = 0;
  await assert.rejects(placement.show(new HistoryPanelLocation(sourceTab, 'right', right), groups.showHistory), /source editor was closed/);
  assert.equal(groups.listeners.size, 0);
});

test('tab updates after switching to an ordinary file clean up the old owned History group', async () => {
  const groups = new FakeTabGroups();
  const left = uri('gitnav-compare:/left'), right = uri('file:/right');
  const diff = groups.add({ original: left, modified: right });
  const placement = new HistoryPanelPlacement(groups, groups.execute);
  await placement.show(new HistoryPanelLocation(diff.tabs[0], 'left', left), groups.showHistory);
  const owned = groups.historyTab!.group;
  const resource = uri('file:/ordinary');
  const ordinary = groups.add({ uri: resource });
  await placement.show(new HistoryPanelLocation(ordinary.tabs[0], 'beside', resource), groups.showHistory);
  await placement.cleanupEmptyGroups();
  assert.ok(!groups.all.includes(owned));
  assert.ok(groups.all.includes(ordinary));
  assert.equal(groups.all.flatMap(group => group.tabs).filter(tab => tab === groups.historyTab).length, 1);
});

test('closing the source while layout loads cannot create History beside an unrelated tab', async () => {
  const groups = new FakeTabGroups();
  const left = uri('gitnav-compare:/left'), right = uri('file:/right');
  const diff = groups.add({ original: left, modified: right });
  const sourceTab = diff.tabs[0];
  const execute = async <T = unknown>(command: string): Promise<T> => {
    const result = await groups.execute<T>(command);
    if (command === 'vscode.getEditorLayout') {
      diff.tabs.splice(0, 1, new FakeTab(diff, { uri: uri('file:/unrelated') }, 'unrelated'));
    }
    return result;
  };
  const placement = new HistoryPanelPlacement(groups, execute);
  await assert.rejects(placement.show(new HistoryPanelLocation(sourceTab, 'left', left), groups.showHistory), /source editor was closed/);
  assert.equal(groups.all.length, 1);
  assert.equal(groups.historyTab, undefined);
  assert.equal(groups.listeners.size, 0);
});

class FakeHistoryWebview {
  html = '';
  readonly cspSource = 'vscode-webview:';
  asWebviewUri(resource: vscode.Uri): vscode.Uri { return resource; }
}

class FakeHistoryPanel {
  readonly webview = new FakeHistoryWebview();
  readonly tab: FakeTab;
  private disposed: (() => void) | undefined;
  constructor(readonly groups: FakeTabGroups, public title: string, column: vscode.ViewColumn) {
    groups.showHistory(column);
    this.tab = groups.historyTab!;
  }
  reveal(column: vscode.ViewColumn): void { this.groups.showHistory(column); }
  onDidDispose(listener: () => void): vscode.Disposable {
    this.disposed = listener;
    return { dispose: () => { this.disposed = undefined; } };
  }
  dispose(): void {
    const tabs = this.tab.group.tabs;
    if (tabs.includes(this.tab)) tabs.splice(tabs.indexOf(this.tab), 1);
    if (this.groups.historyTab === this.tab) this.groups.historyTab = undefined;
    this.disposed?.();
    this.groups.changed();
  }
}

class FakeHistoryPanelApi {
  readonly panels: FakeHistoryPanel[] = [];
  readonly window: {
    tabGroups: FakeTabGroups;
    createWebviewPanel: (viewType: string, title: string, column: vscode.ViewColumn) => FakeHistoryPanel;
  };
  readonly commands: { executeCommand: FakeTabGroups['execute'] };
  constructor(readonly groups: FakeTabGroups) {
    this.window = {
      tabGroups: groups,
      createWebviewPanel: (_viewType: string, title: string, column: vscode.ViewColumn) => {
        const panel = new FakeHistoryPanel(groups, title, column);
        this.panels.push(panel);
        return panel;
      }
    };
    this.commands = { executeCommand: groups.execute };
  }
  readonly Uri = { joinPath: (...parts: unknown[]) => uri(parts.join('/')) };
}

test('queued disposal cleanup does not wait for a replacement History panel to close', async context => {
  const groups = new FakeTabGroups();
  groups.add({ uri: uri('file:/ordinary') });
  const api = new FakeHistoryPanelApi(groups);
  const loader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const originalLoad = loader._load;
  let panel: typeof import('../git/lineHistoryPanel').LineHistoryPanel;
  try {
    loader._load = function(request, parent, isMain) {
      return request === 'vscode' ? api : originalLoad.call(this, request, parent, isMain);
    };
    panel = (require('../git/lineHistoryPanel') as typeof import('../git/lineHistoryPanel')).LineHistoryPanel;
  } finally {
    loader._load = originalLoad;
  }
  const warning = context.mock.method(console, 'warn', () => undefined);
  const extensionUri = uri('file:/extension');
  await panel.show([], 'first', extensionUri);
  const replacement = panel.show([], 'replacement', extensionUri);
  api.panels[0].dispose();
  await replacement;
  await panel.show([], 'latest', extensionUri);
  assert.equal(api.panels.length, 2, 'reuse the replacement instead of creating another panel');
  assert.equal(warning.mock.callCount(), 0, 'cleanup must not time out waiting for a live replacement');
  assert.ok(api.panels[1].webview.html.includes('latest'));
  api.panels[1].dispose();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(groups.listeners.size, 0);
});
