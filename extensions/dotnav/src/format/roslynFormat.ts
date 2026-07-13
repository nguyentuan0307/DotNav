import * as vscode from 'vscode';

export async function formatRangeWithRoslyn(document: vscode.TextDocument, range: vscode.Range, options: vscode.FormattingOptions): Promise<string> {
  const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
    'vscode.executeFormatRangeProvider',
    document.uri,
    range,
    options
  );

  const original = document.getText(range);
  if (!edits || edits.length === 0) {
    return original;
  }

  for (const edit of edits) {
    if (!range.contains(edit.range.start) || !range.contains(edit.range.end)) {
      throw new Error('The C# formatter returned an edit outside the selected range. Formatting was cancelled.');
    }
  }

  const relative = edits
    .map(edit => ({
      start: document.offsetAt(edit.range.start) - document.offsetAt(range.start),
      end: document.offsetAt(edit.range.end) - document.offsetAt(range.start),
      newText: edit.newText
    }))
    .sort((a, b) => b.start - a.start);

  let result = original;
  for (const edit of relative) {
    result = result.slice(0, edit.start) + edit.newText + result.slice(edit.end);
  }

  return result;
}
