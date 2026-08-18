import { buildCodeMask } from '../csharpLexer';
import { analyzeCSharpStructure } from '../csharpStructuralModel';
import { joinLines, leadingWhitespace, splitLines } from '../textLines';
import { formatCSharpWrapping } from './wrapping';
import { normalizeMultilineArgumentLists } from './multilineList';
import { LeadingCommaWrapStyle, PassContext } from './types';

export function formatLeadingCommas(text: string, ctx: PassContext, style: LeadingCommaWrapStyle = 'wrapIfLong'): string {
  const before = analyzeCSharpStructure(text);
  const canRewriteStructure = before.delimiterBalance === BALANCED_DELIMITERS
    || (ctx.allowPartialFragment === true && before.fragmentBoundaryCompatible);
  if (!canRewriteStructure) {
    return alignLeadingCommaFragments(text);
  }
  const wrapped = formatCSharpWrapping(text, ctx, { style });
  const formatted = alignLeadingCommaFragments(normalizeMultilineArgumentLists(wrapped, ctx));
  const after = analyzeCSharpStructure(formatted);
  return before.delimiterBalance === after.delimiterBalance
    && before.semanticFingerprint === after.semanticFingerprint
    ? formatted
    : text;
}

const BALANCED_DELIMITERS = '0:0:0:0:0:0:0';

function alignLeadingCommaFragments(text: string): string {
  const mask = buildCodeMask(text);
  const lines = splitLines(text);
  const depths = parenDepths(lines, text, mask);
  let index = 0;
  while (index < lines.length) {
    if (depths[index] !== 0 || !isLeadingCommaLine(lines[index], mask)) { index++; continue; }
    const start = index;
    while (index < lines.length && depths[index] === 0 && isLeadingCommaLine(lines[index], mask)) index++;
    const previous = previousContentLine(lines, start);
    const anchor = previous !== undefined && !lines[previous].text.trimStart().startsWith(',')
      ? leadingWhitespace(lines[previous].text)
      : leadingWhitespace(lines[start].text);
    for (let i = start; i < index; i++) lines[i].text = anchor + lines[i].text.trimStart();
  }
  return joinLines(lines);
}

function parenDepths(lines: { start: number; end: number }[], text: string, mask: boolean[]): number[] {
  const result: number[] = [];
  let depth = 0;
  for (const line of lines) {
    result.push(depth);
    for (let i = line.start; i < line.end; i++) {
      if (!mask[i]) continue;
      if (text[i] === '(' || text[i] === '[' || text[i] === '{') depth++;
      else if (text[i] === ')' || text[i] === ']' || text[i] === '}') depth = Math.max(0, depth - 1);
    }
  }
  return result;
}

function isLeadingCommaLine(line: { text: string; start: number }, mask: boolean[]): boolean {
  const trimmed = line.text.trimStart();
  const offset = line.text.length - trimmed.length;
  return trimmed.startsWith(',') && mask[line.start + offset] === true;
}

function previousContentLine(lines: { text: string }[], index: number): number | undefined {
  for (let i = index - 1; i >= 0; i--) if (lines[i].text.trim()) return i;
  return undefined;
}
