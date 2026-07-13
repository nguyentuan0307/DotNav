import { buildCodeMask } from '../csharpLexer';
import { joinLines, leadingWhitespace, leadingWidth, splitLines } from '../textLines';
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

    line.text = normalizedIndent(indent, ctx) + line.text.slice(indent.length);
  }

  return joinLines(lines);
}

function normalizedIndent(whitespace: string, ctx: PassContext): string {
  const levels = Math.ceil(leadingWidth(whitespace, ctx.tabSize) / ctx.tabSize);
  return ctx.indentUnit.repeat(levels);
}
