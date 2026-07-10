import { buildCodeMask } from '../csharpLexer';
import { joinLines, leadingWhitespace, splitLines, tabsForLeadingWhitespace } from '../textLines';
import { PassContext } from './types';

export function normalizeIndentWhitespace(text: string, ctx: PassContext): string {
  const mask = buildCodeMask(text);
  const lines = splitLines(text);

  for (const line of lines) {
    const indent = leadingWhitespace(line.text);
    if (!indent.includes(' ')) {
      continue;
    }

    const firstContent = line.start + indent.length;
    if (firstContent >= line.end || !mask[firstContent]) {
      continue;
    }

    line.text = tabsForLeadingWhitespace(indent, ctx.tabSize) + line.text.slice(indent.length);
  }

  return joinLines(lines);
}
