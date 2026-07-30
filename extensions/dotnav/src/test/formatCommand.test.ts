import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'node:module';

class Position {
  constructor(readonly line: number, readonly character: number) {}
  isBefore(other: Position): boolean { return this.compareTo(other) < 0; }
  isAfter(other: Position): boolean { return this.compareTo(other) > 0; }
  isEqual(other: Position): boolean { return this.compareTo(other) === 0; }
  compareTo(other: Position): number {
    return this.line === other.line ? this.character - other.character : this.line - other.line;
  }
}

class Range {
  constructor(readonly start: Position, readonly end: Position) {}
  contains(value: Position | Range): boolean {
    const start = value instanceof Range ? value.start : value;
    const end = value instanceof Range ? value.end : value;
    return this.start.compareTo(start) <= 0 && this.end.compareTo(end) >= 0;
  }
}

class Selection extends Range {
  readonly active: Position;
  constructor(start: Position, end: Position) {
    super(start, end);
    this.active = end;
  }
  get isEmpty(): boolean { return this.start.compareTo(this.end) === 0; }
}

class WorkspaceEdit {
  readonly replacements: Array<{ uri: unknown; range: Range; text: string }> = [];
  replace(uri: unknown, range: Range, text: string): void {
    this.replacements.push({ uri, range, text });
  }
}

class TestDocument {
  readonly languageId = 'csharp';
  readonly uri = { scheme: 'untitled', fsPath: '' };
  version = 1;
  private readonly starts: number[];

  constructor(private readonly text: string) {
    this.starts = [0];
    for (let index = 0; index < text.length; index++) {
      if (text[index] === '\n') this.starts.push(index + 1);
    }
  }

  get lineCount(): number { return this.starts.length; }
  getText(range?: Range): string {
    return range
      ? this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end))
      : this.text;
  }
  lineAt(line: number): { text: string; range: Range; rangeIncludingLineBreak: Range } {
    const start = this.starts[line];
    const next = this.starts[line + 1] ?? this.text.length;
    const contentEnd = next > start && this.text[next - 1] === '\n' ? next - 1 : next;
    const text = this.text.slice(start, contentEnd);
    return {
      text,
      range: new Range(new Position(line, 0), new Position(line, text.length)),
      rangeIncludingLineBreak: new Range(new Position(line, 0), this.positionAt(next))
    };
  }
  positionAt(offset: number): Position {
    let line = 0;
    while (line + 1 < this.starts.length && this.starts[line + 1] <= offset) line++;
    return new Position(line, offset - this.starts[line]);
  }
  offsetAt(position: Position): number {
    return this.starts[position.line] + position.character;
  }
}

let executeFormat: (document: TestDocument, range: Range) => unknown[] = () => [];
let applyResult = true;
let appliedEdit: WorkspaceEdit | undefined;

const vscodeMock = {
  Position,
  Range,
  Selection,
  WorkspaceEdit,
  SymbolKind: {
    Method: 5, Constructor: 8, Property: 6, Field: 7, Event: 24, Operator: 25, Function: 11
  },
  commands: {
    executeCommand: async (command: string, document: TestDocument, range: Range) =>
      command === 'vscode.executeFormatRangeProvider' ? executeFormat(document, range) : []
  },
  workspace: {
    getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
    applyEdit: async (edit: WorkspaceEdit) => {
      appliedEdit = edit;
      return applyResult;
    }
  },
  window: {
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
const { formatSelection } = require('../format/formatSelection') as typeof import('../format/formatSelection');

test.beforeEach(() => {
  executeFormat = () => [];
  applyResult = true;
  appliedEdit = undefined;
});

test('formats the whole document when every cursor is empty', async () => {
  const document = new TestDocument('  var first = 1;\n  var second = 2;');
  const cursor = new Selection(new Position(1, 2), new Position(1, 2));

  await formatSelection(editor(document, [cursor]));

  assert.equal(appliedEdit?.replacements.length, 1);
  assert.equal(appliedEdit?.replacements[0].text, '\tvar first = 1;\n\tvar second = 2;');
  assert.deepEqual(appliedEdit?.replacements[0].range.start, new Position(0, 0));
  assert.deepEqual(appliedEdit?.replacements[0].range.end, document.positionAt(document.getText().length));
});

test('formats and applies multiple non-overlapping selections atomically', async () => {
  const document = new TestDocument('  first();\nkeep();\n   third();');
  const selections = [
    new Selection(new Position(0, 1), new Position(0, 5)),
    new Selection(new Position(2, 1), new Position(2, 6))
  ];

  await formatSelection(editor(document, selections));

  assert.equal(appliedEdit?.replacements.length, 2);
  assert.deepEqual(appliedEdit?.replacements.map(item => item.text), ['\tfirst();\n', '\tthird();']);
});

test('cancels stale formatting before applying an edit', async () => {
  const document = new TestDocument('  first();');
  executeFormat = () => {
    document.version++;
    return [];
  };

  await assert.rejects(
    formatSelection(editor(document, [new Selection(new Position(0, 0), new Position(0, 3))])),
    /document changed while formatting/
  );
  assert.equal(appliedEdit, undefined);
});

test('reports an edit rejected by VS Code', async () => {
  const document = new TestDocument('  first();');
  applyResult = false;

  await assert.rejects(
    formatSelection(editor(document, [new Selection(new Position(0, 0), new Position(0, 3))])),
    /rejected the formatting edit/
  );
});

test('rejects overlapping Roslyn edits instead of applying ambiguous text', async () => {
  const document = new TestDocument('first();');
  executeFormat = () => [
    { range: new Range(new Position(0, 0), new Position(0, 3)), newText: 'one' },
    { range: new Range(new Position(0, 2), new Position(0, 5)), newText: 'two' }
  ];

  await assert.rejects(
    formatSelection(editor(document, [new Selection(new Position(0, 0), new Position(0, 6))])),
    /overlapping edits/
  );
  assert.equal(appliedEdit, undefined);
});

test('restores an intentional two-level fluent indent after Roslyn normalizes it', async () => {
  const original = [
    '\t\tvar recordFields = fields',
    '\t\t\t\t.Where(item => item.Enabled)',
    '\t\t\t\t.Select(item => item.Id)',
    '\t\t\t\t.ToList();'
  ].join('\n');
  const roslynNormalized = [
    '\t\tvar recordFields = fields',
    '\t\t\t.Where(item => item.Enabled)',
    '\t\t\t.Select(item => item.Id)',
    '\t\t\t.ToList();'
  ].join('\n');
  const document = new TestDocument(original);
  executeFormat = (_document, range) => [{ range, newText: roslynNormalized }];

  await formatSelection(editor(document, [
    new Selection(new Position(0, 0), new Position(0, 0))
  ]));

  assert.equal(appliedEdit, undefined);
});

function editor(document: TestDocument, selections: Selection[]) {
  return {
    document,
    selection: selections[0],
    selections,
    options: { tabSize: 4, insertSpaces: false }
  } as never;
}
