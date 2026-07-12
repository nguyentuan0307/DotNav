import { buildCodeMask, isCodeOnly } from '../csharpLexer';
import { joinLines, leadingWhitespace, splitLines } from '../textLines';
import { PassContext } from './types';

const WRAP_THRESHOLD = 120;

export function formatLeadingCommas(text: string, ctx: PassContext): string {
  return normalizeMultilineLeadingCommas(wrapLongSingleLineLists(text, ctx), ctx);
}

function normalizeMultilineLeadingCommas(text: string, ctx: PassContext): string {
  const mask = buildCodeMask(text);
  const lines = splitLines(text);

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.text.trimStart();
    if (!trimmed.startsWith(',') || !isCodeOnly(mask, line.start, line.end)) {
      continue;
    }

    const baseIndent = inferListItemIndent(lines, i, ctx.indentUnit);
    line.text = baseIndent + ctx.indentUnit + trimmed;
  }

  return joinLines(lines);
}

function wrapLongSingleLineLists(text: string, ctx: PassContext): string {
  const mask = buildCodeMask(text);
  const lines = splitLines(text);

  for (const line of lines) {
    if (line.text.length <= WRAP_THRESHOLD || !isCodeOnly(mask, line.start, line.end)) {
      continue;
    }

    const wrapped = wrapLineList(line.text, ctx);
    if (wrapped) {
      line.text = wrapped;
    }
  }

  return joinLines(lines);
}

function wrapLineList(line: string, ctx: PassContext): string | undefined {
  const open = line.indexOf('(');
  const close = line.lastIndexOf(')');
  if (open < 0 || close <= open) {
    return undefined;
  }

  const inner = line.slice(open + 1, close);
  const parts = splitTopLevelCommas(inner);
  if (parts.length < 2) {
    return undefined;
  }

  const prefix = line.slice(0, open + 1).trimEnd();
  const suffix = line.slice(close + 1).trimStart();
  const baseIndent = leadingWhitespace(line);
  const itemIndent = baseIndent + ctx.indentUnit;
  const output = [prefix];
  output.push(itemIndent + parts[0].trim());
  for (const part of parts.slice(1)) {
    output.push(itemIndent + ', ' + part.trim());
  }
  output.push(baseIndent + ')' + suffix);
  return output.join(ctx.eol);
}

function splitTopLevelCommas(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let angle = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') {
      paren++;
    } else if (ch === ')') {
      paren--;
    } else if (ch === '[') {
      bracket++;
    } else if (ch === ']') {
      bracket--;
    } else if (ch === '{') {
      brace++;
    } else if (ch === '}') {
      brace--;
    } else if (ch === '<') {
      angle++;
    } else if (ch === '>') {
      angle = Math.max(0, angle - 1);
    } else if (ch === ',' && paren === 0 && bracket === 0 && brace === 0 && angle === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(text.slice(start));
  return parts.map(part => part.trim()).filter(Boolean);
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
