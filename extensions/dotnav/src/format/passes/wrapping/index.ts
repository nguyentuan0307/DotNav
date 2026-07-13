import { buildCodeMask } from '../../csharpLexer';
import { joinLines, leadingWhitespace, splitLines } from '../../textLines';
import { LeadingCommaWrapStyle, PassContext } from '../types';

export interface CSharpWrappingSettings {
  style: LeadingCommaWrapStyle;
}

const CONTROL_KEYWORDS = new Set(['if', 'while', 'for', 'foreach', 'switch', 'catch', 'using', 'lock', 'fixed', 'return']);

export function formatCSharpWrapping(text: string, ctx: PassContext, settings: CSharpWrappingSettings): string {
  if (settings.style === 'keep') return text;
  const lines = splitLines(text);
  let parenDepth = 0;
  for (const line of lines) {
    const delta = codeParenDelta(line.text);
    const isStandalone = parenDepth === 0 && delta === 0;
    if (isStandalone && !line.text.trimStart().startsWith(',')
      && (settings.style !== 'wrapIfLong' || visualWidth(line.text, ctx.tabSize) > ctx.wrapColumn)) {
      const wrapped = wrapBestList(line.text, ctx, settings.style === 'chopAlways');
      if (wrapped) line.text = wrapped;
    }
    parenDepth = Math.max(0, parenDepth + delta);
  }
  return joinLines(lines);
}

function codeParenDelta(line: string): number {
  const mask = buildCodeMask(line);
  let delta = 0;
  for (let i = 0; i < line.length; i++) {
    if (!mask[i]) continue;
    if (line[i] === '(') delta++;
    else if (line[i] === ')') delta--;
  }
  return delta;
}

function wrapBestList(line: string, ctx: PassContext, chop: boolean): string | undefined {
  const mask = buildCodeMask(line);
  const stack: number[] = [];
  const pairs: Array<{ open: number; close: number }> = [];
  for (let i = 0; i < line.length; i++) {
    if (!mask[i]) continue;
    if (line[i] === '(') stack.push(i);
    else if (line[i] === ')' && stack.length) pairs.push({ open: stack.pop()!, close: i });
  }
  pairs.sort((a, b) => a.open - b.open);
  for (const pair of pairs) {
    if (isWithinControlFlow(line, pair, pairs)) continue;
    const parts = splitItems(line, mask, pair.open + 1, pair.close);
    if (parts.length < 2) continue;
    return render(line, pair.open, pair.close, parts, ctx, chop);
  }
  return undefined;
}

function isWithinControlFlow(line: string, pair: { open: number; close: number }, pairs: Array<{ open: number; close: number }>): boolean {
  return pairs.some(candidate => candidate.open <= pair.open && candidate.close >= pair.close && isControlFlow(line, candidate.open));
}

function splitItems(line: string, mask: boolean[], start: number, end: number): string[] {
  const parts: string[] = [];
  let itemStart = start, paren = 0, bracket = 0, brace = 0, angle = 0;
  for (let i = start; i < end; i++) {
    if (!mask[i]) continue;
    const ch = line[i];
    if (ch === '(') paren++;
    else if (ch === ')') paren--;
    else if (ch === '[') bracket++;
    else if (ch === ']') bracket--;
    else if (ch === '{') brace++;
    else if (ch === '}') brace--;
    else if (ch === '<' && looksLikeGenericOpen(line, i)) angle++;
    else if (ch === '>' && angle) angle--;
    else if (ch === ',' && !paren && !bracket && !brace && !angle) {
      parts.push(line.slice(itemStart, i).trim()); itemStart = i + 1;
    }
  }
  parts.push(line.slice(itemStart, end).trim());
  return parts.filter(Boolean);
}

function render(line: string, open: number, close: number, parts: string[], ctx: PassContext, chop: boolean): string {
  const prefix = line.slice(0, open + 1).trimEnd();
  const suffix = line.slice(close + 1).trimStart();
  const indent = leadingWhitespace(line) + ctx.indentUnit;
  const output = [prefix + parts[0]];
  for (const part of parts.slice(1)) {
    const addition = ', ' + part;
    const last = output.length - 1;
    if (!chop && visualWidth(output[last] + addition, ctx.tabSize) <= ctx.wrapColumn) output[last] += addition;
    else output.push(indent + addition);
  }
  const closing = ')' + suffix;
  const last = output.length - 1;
  if (!chop && visualWidth(output[last] + closing, ctx.tabSize) <= ctx.wrapColumn) output[last] += closing;
  else output.push(leadingWhitespace(line) + closing);
  return output.join(ctx.eol);
}

function isControlFlow(line: string, open: number): boolean {
  const match = line.slice(0, open).match(/([A-Za-z_]\w*)\s*$/);
  return !!match && CONTROL_KEYWORDS.has(match[1]);
}

function looksLikeGenericOpen(line: string, index: number): boolean {
  return /[\w)>\]]/.test(line[index - 1] ?? '') && /[\w@[(]/.test(line[index + 1] ?? '');
}

function visualWidth(value: string, tabSize: number): number {
  let width = 0;
  for (const ch of value) width += ch === '\t' ? tabSize - (width % tabSize) : 1;
  return width;
}
