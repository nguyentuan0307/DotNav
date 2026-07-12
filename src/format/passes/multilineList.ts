import { buildCodeMask } from '../csharpLexer';
import { joinLines, leadingWhitespace, splitLines } from '../textLines';
import { PassContext } from './types';

interface Pair { open: number; close: number }

export function normalizeMultilineArgumentLists(text: string, ctx: PassContext): string {
  const mask = buildCodeMask(text);
  const lines = splitLines(text);
  const pairs = findParenPairs(text, mask);

  for (const pair of pairs) {
    const openLine = lineIndexAt(lines, pair.open);
    const closeLine = lineIndexAt(lines, pair.close);
    if (openLine === closeLine || isWithinControlFlow(text, pair, pairs) || hasUnsafeTrivia(lines, openLine, closeLine)) continue;

    const separators = topLevelCommas(text, mask, pair.open + 1, pair.close);
    if (separators.length === 0) continue;
    const separatorLines = separators.map(offset => lineIndexAt(lines, offset));
    if (separatorLines.some((lineIndex, index) => lines[lineIndex].text.slice(separators[index] - lines[lineIndex].start + 1).trim() !== '')) continue;

    const baseIndent = leadingWhitespace(lines[openLine].text);
    const itemIndent = baseIndent + ctx.indentUnit;
    const firstItemLine = nextContentLine(lines, openLine + 1, closeLine);
    if (firstItemLine !== undefined) reindent(lines[firstItemLine], itemIndent);

    for (let i = 0; i < separators.length; i++) {
      const separatorLine = separatorLines[i];
      lines[separatorLine].text = lines[separatorLine].text.replace(/,\s*$/, '');
      const nextItemLine = nextContentLine(lines, separatorLine + 1, closeLine);
      if (nextItemLine !== undefined) reindent(lines[nextItemLine], itemIndent + ', ');
    }
    reindent(lines[closeLine], baseIndent);
  }

  return joinLines(lines);
}

function isWithinControlFlow(text: string, pair: Pair, pairs: Pair[]): boolean {
  return pairs.some(candidate => candidate.open <= pair.open && candidate.close >= pair.close && isControlFlow(text, candidate.open));
}

function hasUnsafeTrivia(lines: { text: string }[], start: number, end: number): boolean {
  for (let i = start + 1; i < end; i++) {
    const trimmed = lines[i].text.trimStart();
    if (trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return true;
  }
  return false;
}

function findParenPairs(text: string, mask: boolean[]): Pair[] {
  const stack: number[] = [];
  const pairs: Pair[] = [];
  for (let i = 0; i < text.length; i++) {
    if (!mask[i]) continue;
    if (text[i] === '(') stack.push(i);
    else if (text[i] === ')' && stack.length) pairs.push({ open: stack.pop()!, close: i });
  }
  return pairs.sort((a, b) => b.open - a.open);
}

function topLevelCommas(text: string, mask: boolean[], start: number, end: number): number[] {
  const result: number[] = [];
  let paren = 0, bracket = 0, brace = 0, angle = 0;
  for (let i = start; i < end; i++) {
    if (!mask[i]) continue;
    const ch = text[i];
    if (ch === '(') paren++;
    else if (ch === ')') paren--;
    else if (ch === '[') bracket++;
    else if (ch === ']') bracket--;
    else if (ch === '{') brace++;
    else if (ch === '}') brace--;
    else if (ch === '<' && looksLikeGenericOpen(text, i)) angle++;
    else if (ch === '>' && angle) angle--;
    else if (ch === ',' && !paren && !bracket && !brace && !angle) result.push(i);
  }
  return result;
}

function looksLikeGenericOpen(text: string, index: number): boolean {
  return /[\w)>\]]/.test(text[index - 1] ?? '') && /[\w@[(]/.test(text[index + 1] ?? '');
}

function lineIndexAt(lines: { start: number; end: number }[], offset: number): number {
  for (let i = 0; i < lines.length; i++) if (offset >= lines[i].start && offset <= lines[i].end) return i;
  return lines.length - 1;
}

function nextContentLine(lines: { text: string }[], start: number, end: number): number | undefined {
  for (let i = start; i < end; i++) if (lines[i].text.trim()) return i;
  return undefined;
}

function reindent(line: { text: string }, indent: string): void {
  line.text = indent + line.text.trimStart().replace(/^,\s*/, '');
}

function isControlFlow(text: string, open: number): boolean {
  const match = text.slice(0, open).match(/([A-Za-z_]\w*)\s*$/);
  return !!match && new Set(['if', 'while', 'for', 'foreach', 'switch', 'catch', 'using', 'lock', 'fixed', 'return']).has(match[1]);
}
