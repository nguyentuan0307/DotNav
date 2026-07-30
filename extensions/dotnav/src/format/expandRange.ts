import * as vscode from 'vscode';

export async function expandSelectionRange(document: vscode.TextDocument, selection: vscode.Selection, expandToMember: boolean): Promise<vscode.Range> {
  return (await expandSelectionRanges(document, [selection], expandToMember))[0];
}

export async function expandSelectionRanges(
  document: vscode.TextDocument,
  selections: readonly vscode.Selection[],
  expandToMember: boolean
): Promise<vscode.Range[]> {
  if (selections.length === 0 || selections.every(selection => selection.isEmpty)) {
    return [documentRange(document)];
  }

  const selectedRanges = selections
    .filter(selection => !selection.isEmpty)
    .map(selection => normalizeSelectionToLineRange(document, selection));
  if (!expandToMember) {
    return mergeRanges(selectedRanges);
  }

  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    'vscode.executeDocumentSymbolProvider',
    document.uri
  );

  if (!symbols || symbols.length === 0) {
    throw new Error('C# document symbols are not ready yet. Try again after the C# extension finishes loading.');
  }

  const allSymbols = flattenSymbols(symbols);
  const members = allSymbols.filter(symbol => isMemberLike(symbol.kind));
  const expanded = selectedRanges.map(selectedRange =>
    expandRangeToMembers(document, selectedRange, members, allSymbols));
  return mergeRanges(expanded);
}

export function unionRange(left: vscode.Range, right: vscode.Range): vscode.Range {
  const start = left.start.isBefore(right.start) ? left.start : right.start;
  const end = left.end.isAfter(right.end) ? left.end : right.end;
  return new vscode.Range(start, end);
}

export function mergeRanges(ranges: readonly vscode.Range[]): vscode.Range[] {
  const sorted = [...ranges].sort((left, right) => left.start.compareTo(right.start));
  const merged: vscode.Range[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && !previous.end.isBefore(range.start)) {
      merged[merged.length - 1] = unionRange(previous, range);
    } else {
      merged.push(range);
    }
  }
  return merged;
}

function normalizeSelectionToLineRange(document: vscode.TextDocument, selection: vscode.Selection): vscode.Range {
  if (selection.isEmpty) {
    return documentRange(document);
  }

  return normalizeRangeToFullLines(document, selection);
}

function documentRange(document: vscode.TextDocument): vscode.Range {
  return new vscode.Range(new vscode.Position(0, 0), document.positionAt(document.getText().length));
}

function expandRangeToMembers(
  document: vscode.TextDocument,
  selectedRange: vscode.Range,
  members: readonly vscode.DocumentSymbol[],
  allSymbols: readonly vscode.DocumentSymbol[]
): vscode.Range {
  const touched = members.filter(symbol => rangesIntersect(symbol.range, selectedRange));
  if (touched.length === 0) {
    const enclosing = allSymbols
      .filter(symbol => symbol.range.contains(selectedRange))
      .sort((a, b) => rangeSize(a.range) - rangeSize(b.range))[0];
    return normalizeRangeToFullLines(document, enclosing?.range ?? selectedRange);
  }

  let range = touched[0].range;
  for (const symbol of touched.slice(1)) {
    range = unionRange(range, symbol.range);
  }
  return normalizeRangeToFullLines(document, range);
}

function normalizeRangeToFullLines(document: vscode.TextDocument, range: vscode.Range): vscode.Range {
  const startLine = Math.max(0, range.start.line);
  const endLine = Math.min(document.lineCount - 1, range.end.character === 0 && range.end.line > startLine ? range.end.line - 1 : range.end.line);
  return new vscode.Range(
    new vscode.Position(startLine, 0),
    document.lineAt(endLine).rangeIncludingLineBreak.end
  );
}

function flattenSymbols(symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] {
  const result: vscode.DocumentSymbol[] = [];
  const visit = (symbol: vscode.DocumentSymbol) => {
    result.push(symbol);
    for (const child of symbol.children) {
      visit(child);
    }
  };
  for (const symbol of symbols) {
    visit(symbol);
  }
  return result;
}

function rangesIntersect(left: vscode.Range, right: vscode.Range): boolean {
  return left.start.isBefore(right.end) && right.start.isBefore(left.end);
}

function rangeSize(range: vscode.Range): number {
  return (range.end.line - range.start.line) * 100000 + (range.end.character - range.start.character);
}

function isMemberLike(kind: vscode.SymbolKind): boolean {
  return [
    vscode.SymbolKind.Method,
    vscode.SymbolKind.Constructor,
    vscode.SymbolKind.Property,
    vscode.SymbolKind.Field,
    vscode.SymbolKind.Event,
    vscode.SymbolKind.Operator,
    vscode.SymbolKind.Function
  ].includes(kind);
}
