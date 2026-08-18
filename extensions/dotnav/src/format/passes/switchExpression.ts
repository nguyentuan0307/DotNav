import { buildCodeMask } from '../csharpLexer';
import { analyzeCSharpStructure } from '../csharpStructuralModel';
import { joinLines, leadingWhitespace, splitLines } from '../textLines';
import { PassContext } from './types';

export function formatSwitchExpressions(text: string, ctx: PassContext): string {
  const before = analyzeCSharpStructure(text);
  if (before.delimiterBalance !== '0:0:0:0:0:0:0' && !ctx.allowPartialFragment) {
    return text;
  }

  const mask = buildCodeMask(text);
  const lines = splitLines(text);
  const switchBlocks = findSwitchBlocks(text, lines, mask);

  if (switchBlocks.length === 0) return text;

  for (const block of switchBlocks) {
    const baseIndent = leadingWhitespace(lines[block.switchLine].text);
    const armIndent = baseIndent + ctx.indentUnit;

    // First pass: indent each arm line and align closing brace
    const armLines: number[] = [];
    for (let i = block.openBraceLine + 1; i < block.closeBraceLine; i++) {
      const trimmed = lines[i].text.trimStart();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        lines[i].text = armIndent + trimmed;
        continue;
      }
      lines[i].text = armIndent + trimmed;
      armLines.push(i);
    }

    // Align closing brace
    lines[block.closeBraceLine].text = baseIndent + lines[block.closeBraceLine].text.trimStart();

    // Second pass: column-align => if arms are single-line pattern => result
    alignSwitchArmArrows(lines, armLines, armIndent, mask, text);
  }

  const formatted = joinLines(lines);
  const after = analyzeCSharpStructure(formatted);
  return before.delimiterBalance === after.delimiterBalance
    && before.semanticFingerprint === after.semanticFingerprint
    ? formatted
    : text;
}

interface SwitchBlock {
  switchLine: number;
  openBraceLine: number;
  closeBraceLine: number;
}

function findSwitchBlocks(
  text: string,
  lines: readonly { text: string; start: number; end: number }[],
  mask: readonly boolean[]
): SwitchBlock[] {
  const blocks: SwitchBlock[] = [];

  for (let i = 0; i < text.length - 6; i++) {
    if (!mask[i]) continue;
    if (text.slice(i, i + 6) === 'switch' && isWordBoundary(text, i, 6)) {
      // Check if this switch is a switch expression: expression switch { ... }
      // In switch expression, switch keyword is followed by '{' without a parenthesized condition before '{'
      let cursor = i + 6;
      while (cursor < text.length && (!mask[cursor] || /\s/.test(text[cursor]))) cursor++;
      if (cursor < text.length && mask[cursor] && text[cursor] === '{') {
        const switchLine = findLineIndex(lines, i);
        const openBraceLine = findLineIndex(lines, cursor);
        const closeBraceOffset = findMatchingBrace(text, cursor, mask);
        if (closeBraceOffset >= 0) {
          const closeBraceLine = findLineIndex(lines, closeBraceOffset);
          if (openBraceLine < closeBraceLine) {
            blocks.push({ switchLine, openBraceLine, closeBraceLine });
          }
        }
      }
    }
  }

  return blocks;
}

function isWordBoundary(text: string, start: number, length: number): boolean {
  const before = start > 0 ? text[start - 1] : ' ';
  const after = start + length < text.length ? text[start + length] : ' ';
  return !/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9_]/.test(after);
}

function findMatchingBrace(text: string, openOffset: number, mask: readonly boolean[]): number {
  let depth = 0;
  for (let i = openOffset; i < text.length; i++) {
    if (!mask[i]) continue;
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findLineIndex(lines: readonly { start: number }[], offset: number): number {
  let low = 0;
  let high = lines.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].start <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high);
}

function alignSwitchArmArrows(
  lines: { text: string }[],
  armLines: readonly number[],
  armIndent: string,
  mask: readonly boolean[],
  text: string
): void {
  if (armLines.length < 2) return;

  const parsedArms: Array<{ lineIndex: number; isLeadingComma: boolean; pattern: string; result: string }> = [];

  for (const lineIndex of armLines) {
    const trimmed = lines[lineIndex].text.trimStart();
    const isLeadingComma = trimmed.startsWith(',');
    const content = isLeadingComma ? trimmed.slice(1).trimStart() : trimmed;
    const arrowIndex = content.indexOf('=>');
    if (arrowIndex <= 0) return; // not all arms are standard pattern => result
    const pattern = content.slice(0, arrowIndex).trimEnd();
    const result = content.slice(arrowIndex + 2).trimStart();
    parsedArms.push({ lineIndex, isLeadingComma, pattern, result });
  }

  // Find max pattern length
  let maxPatternLen = 0;
  for (const arm of parsedArms) {
    if (arm.pattern.length > maxPatternLen) {
      maxPatternLen = arm.pattern.length;
    }
  }

  const hasAnyLeading = parsedArms.some(arm => arm.isLeadingComma);

  // Column align
  for (const arm of parsedArms) {
    let prefix = armIndent;
    if (hasAnyLeading) {
      prefix = arm.isLeadingComma ? `${armIndent}, ` : `${armIndent}  `;
    }
    const padding = ' '.repeat(maxPatternLen - arm.pattern.length + 1);
    lines[arm.lineIndex].text = `${prefix}${arm.pattern}${padding}=> ${arm.result}`;
  }
}
