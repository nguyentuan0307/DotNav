import { buildCodeMask } from '../csharpLexer';
import { joinLines, leadingWhitespace, splitLines } from '../textLines';
import { formatCSharpWrapping } from './wrapping';
import { LeadingCommaWrapStyle, PassContext } from './types';

export function formatLeadingCommas(text: string, ctx: PassContext, style: LeadingCommaWrapStyle = 'wrapIfLong'): string {
  return normalizeMultilineLeadingCommas(formatCSharpWrapping(text, ctx, { style }), ctx);
}

function normalizeMultilineLeadingCommas(text: string, ctx: PassContext): string {
  const mask = buildCodeMask(text);
  const lines = splitLines(text);

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.text.trimStart();
    const commaOffset = line.text.length - trimmed.length;
    if (!trimmed.startsWith(',') || mask[line.start + commaOffset] !== true) {
      continue;
    }

    const baseIndent = inferListItemIndent(lines, i, ctx.indentUnit);
    line.text = baseIndent + ctx.indentUnit + trimmed;
  }

  return joinLines(lines);
}

function inferListItemIndent(lines: { text: string }[], index: number, indentUnit: string): string {
  for (let i = index - 1; i >= 0; i--) {
    const trimmed = lines[i].text.trim();
    if (trimmed.endsWith('(') || (trimmed.includes('(') && !trimmed.includes(')'))) {
      return leadingWhitespace(lines[i].text);
    }
  }

  const previous = findPreviousContentLine(lines, index);
  return previous === undefined ? '' : leadingWhitespace(lines[previous].text).slice(0, -indentUnit.length);
}

function findPreviousContentLine(lines: { text: string }[], index: number): number | undefined {
  for (let i = index - 1; i >= 0; i--) {
    if (lines[i].text.trim() !== '') {
      return i;
    }
  }
  return undefined;
}
