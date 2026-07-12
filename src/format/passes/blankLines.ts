import { joinLines, splitLines } from '../textLines';

export function normalizeBlankLines(text: string): string {
  const lines = splitLines(text);
  const result = [];
  let blankRun = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.text.trim();
    const previous = result[result.length - 1];
    const previousTrimmed = previous?.text.trim() ?? '';
    const nextTrimmed = nextContentTrimmed(lines, i);

    if (trimmed === '') {
      if (previousTrimmed === '{' || previousTrimmed.startsWith('#region') || nextTrimmed === '}' || nextTrimmed.startsWith('#endregion')) {
        continue;
      }
      blankRun++;
      if (blankRun > 1) {
        continue;
      }
    } else {
      blankRun = 0;
    }

    result.push(line);
  }

  return joinLines(result);
}

function nextContentTrimmed(lines: { text: string }[], index: number): string {
  for (let i = index + 1; i < lines.length; i++) {
    const trimmed = lines[i].text.trim();
    if (trimmed !== '') {
      return trimmed;
    }
  }
  return '';
}
