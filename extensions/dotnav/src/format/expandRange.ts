import * as vscode from 'vscode';

export async function expandSelectionRange(document: vscode.TextDocument, selection: vscode.Selection, expandToMember: boolean): Promise<vscode.Range> {
  const selectedRange = normalizeSelectionToLineRange(document, selection);
  if (!expandToMember) {
    return selectedRange;
  }

  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    'vscode.executeDocumentSymbolProvider',
    document.uri
  );

  if (!symbols || symbols.length === 0) {
    throw new Error('C# document symbols are not ready yet. Try again after the C# extension finishes loading.');
  }

  const flat = flattenSymbols(symbols).filter(symbol => isMemberLike(symbol.kind));
  const touched = flat.filter(symbol => rangesIntersect(symbol.range, selectedRange));

  if (touched.length === 0) {
    const enclosing = flattenSymbols(symbols)
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

export function unionRange(left: vscode.Range, right: vscode.Range): vscode.Range {
  const start = left.start.isBefore(right.start) ? left.start : right.start;
  const end = left.end.isAfter(right.end) ? left.end : right.end;
  return new vscode.Range(start, end);
}

function normalizeSelectionToLineRange(document: vscode.TextDocument, selection: vscode.Selection): vscode.Range {
  if (selection.isEmpty) {
    const line = document.lineAt(selection.active.line);
    return new vscode.Range(line.range.start, line.range.end);
  }

  return normalizeRangeToFullLines(document, selection);
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
