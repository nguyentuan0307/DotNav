import * as vscode from 'vscode';

class RelativeFormattingEdit {
  constructor(
    readonly start: number,
    readonly end: number,
    readonly newText: string
  ) {}
}

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

  const rangeStart = document.offsetAt(range.start);
  const relative = edits.map(edit => new RelativeFormattingEdit(
    document.offsetAt(edit.range.start) - rangeStart,
    document.offsetAt(edit.range.end) - rangeStart,
    edit.newText
  ));
  validateEdits(relative, original.length);
  relative.sort((a, b) => b.start - a.start);

  let result = original;
  for (const edit of relative) {
    result = result.slice(0, edit.start) + edit.newText + result.slice(edit.end);
  }

  return result;
}

function validateEdits(edits: RelativeFormattingEdit[], textLength: number): void {
  const ordered = [...edits].sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 0; index < ordered.length; index++) {
    const current = ordered[index];
    if (current.start < 0 || current.end < current.start || current.end > textLength) {
      throw new Error('The C# formatter returned an invalid edit. Formatting was cancelled.');
    }
    const previous = ordered[index - 1];
    if (previous && (current.start < previous.end || current.start === previous.start)) {
      throw new Error('The C# formatter returned overlapping edits. Formatting was cancelled.');
    }
  }
}
