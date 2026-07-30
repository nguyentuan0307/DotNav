import { classifySpans } from '../csharpLexer';
import { joinLines, splitLines } from '../textLines';

export function normalizeBlankLines(text: string): string {
  const lines = splitLines(text);
  const protectedLines = findProtectedLines(text, lines);
  const result = [];
  let blankRun = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (protectedLines[i]) {
      result.push(line);
      blankRun = 0;
      continue;
    }
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

function findProtectedLines(
  text: string,
  lines: readonly { start: number }[]
): boolean[] {
  const differences = new Array<number>(lines.length + 1).fill(0);
  for (const span of classifySpans(text)) {
    if (!isMultilineProtectedSpan(span.kind)) continue;
    const value = text.slice(span.start, span.end);
    if (!/[\r\n]/.test(value)) continue;
    const startLine = lineIndexAt(lines, span.start);
    const endLine = lineIndexAt(lines, Math.max(span.start, span.end - 1));
    differences[startLine]++;
    differences[endLine + 1]--;
  }

  const protectedLines = new Array<boolean>(lines.length).fill(false);
  let depth = 0;
  for (let index = 0; index < lines.length; index++) {
    depth += differences[index];
    protectedLines[index] = depth > 0;
  }
  return protectedLines;
}

function isMultilineProtectedSpan(kind: ReturnType<typeof classifySpans>[number]['kind']): boolean {
  return kind === 'blockComment'
    || kind === 'string'
    || kind === 'verbatimString'
    || kind === 'rawString'
    || kind === 'charLiteral';
}

function lineIndexAt(lines: readonly { start: number }[], offset: number): number {
  let low = 0;
  let high = lines.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].start <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high);
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
