import { buildCodeMask, isCodeOnly } from '../csharpLexer';
import { joinLines, leadingWhitespace, splitLines } from '../textLines';
import { PassContext } from './types';

export function formatFluentChains(text: string, ctx: PassContext): string {
  const mask = buildCodeMask(text);
  const lines = splitLines(text);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.text.trimStart();
    if (!trimmed.startsWith('.') || !isCodeOnly(mask, line.start, line.end)) {
      i++;
      continue;
    }

    const baseIndent = inferPreviousIndent(lines, i) ?? leadingWhitespace(line.text);
    const runStart = i;
    let runEnd = i;
    let dotCount = 0;
    let initializerDepth = 0;
    const rewriteLines = new Set<number>();

    while (runEnd < lines.length) {
      const current = lines[runEnd];
      const currentTrimmed = current.text.trimStart();
      if (!isCodeOnly(mask, current.start, current.end)) {
        break;
      }

      if (currentTrimmed.startsWith('.')) {
        dotCount++;
        rewriteLines.add(runEnd);
        runEnd++;
        continue;
      }

      if (currentTrimmed === '{') {
        initializerDepth++;
        rewriteLines.add(runEnd);
        runEnd++;
        continue;
      }

      if (initializerDepth > 0 && /^[A-Za-z_@][\w@]*\s*=/.test(currentTrimmed)) {
        rewriteLines.add(runEnd);
        runEnd++;
        continue;
      }

      if (initializerDepth > 0 && currentTrimmed === '}') {
        initializerDepth--;
        rewriteLines.add(runEnd);
        runEnd++;
        continue;
      }

      if (initializerDepth > 0 && currentTrimmed.startsWith('})')) {
        initializerDepth--;
        rewriteLines.add(runEnd);
        runEnd++;
        continue;
      }

      break;
    }

    if (dotCount >= ctx.fluentChainMinSegments) {
      for (let j = runStart; j < runEnd; j++) {
        if (rewriteLines.has(j)) {
          lines[j].text = baseIndent + ctx.indentUnit + lines[j].text.trimStart();
        }
      }
    }

    i = Math.max(runEnd, i + 1);
  }

  return joinLines(lines);
}

function inferPreviousIndent(lines: { text: string }[], index: number): string | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const trimmed = lines[i].text.trim();
    if (trimmed !== '') {
      return leadingWhitespace(lines[i].text);
    }
  }
  return undefined;
}
