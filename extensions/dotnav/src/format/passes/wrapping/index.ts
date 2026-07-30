import { buildCodeMask } from '../../csharpLexer';
import { buildCSharpListModel } from '../../csharpStructuralModel';
import { joinLines, leadingWhitespace, splitLines } from '../../textLines';
import { continuationIndent } from '../continuationIndent';
import { LeadingCommaWrapStyle, PassContext } from '../types';

export interface CSharpWrappingSettings {
  style: LeadingCommaWrapStyle;
}

export function formatCSharpWrapping(text: string, ctx: PassContext, settings: CSharpWrappingSettings): string {
  if (settings.style === 'keep' || ctx.enableWrapping === false) return text;
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
  const pairs = buildCSharpListModel(line, mask).sort((a, b) => a.open - b.open);
  for (const pair of pairs) {
    if (pair.controlFlowAncestor) continue;
    const parts = splitItems(line, pair.open + 1, pair.close, pair.separators);
    if (parts.length < 2) continue;
    return render(line, pair.open, pair.close, parts, ctx, chop);
  }
  return undefined;
}

function splitItems(line: string, start: number, end: number, separators: readonly number[]): string[] {
  const parts: string[] = [];
  let itemStart = start;
  for (const separator of separators) {
    parts.push(line.slice(itemStart, separator).trim());
    itemStart = separator + 1;
  }
  parts.push(line.slice(itemStart, end).trim());
  return parts.filter(Boolean);
}

function render(line: string, open: number, close: number, parts: string[], ctx: PassContext, chop: boolean): string {
  const prefix = line.slice(0, open + 1).trimEnd();
  const suffix = line.slice(close + 1).trimStart();
  const indent = leadingWhitespace(line) + continuationIndent(ctx);
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

function visualWidth(value: string, tabSize: number): number {
  let width = 0;
  for (const ch of value) width += ch === '\t' ? tabSize - (width % tabSize) : 1;
  return width;
}
