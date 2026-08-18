import { buildCodeMask } from '../csharpLexer';
import { buildCSharpListModel, CSharpListNode } from '../csharpStructuralModel';
import { multilineListSignature } from '../formattingStyleDetector';
import { joinLines, leadingWhitespace, leadingWidth, splitLines } from '../textLines';
import { continuationIndent } from './continuationIndent';
import { PassContext } from './types';

export function normalizeMultilineArgumentLists(text: string, ctx: PassContext): string {
  const mask = buildCodeMask(text);
  const sourceLines = splitLines(text);
  const lines = splitLines(text);
  const pairs = buildCSharpListModel(text, mask);
  const trivia = buildTriviaIndex(sourceLines);

  for (const pair of pairs) {
    const openLine = lineIndexAt(sourceLines, pair.open);
    const closeLine = lineIndexAt(sourceLines, pair.close);
    if (openLine === closeLine
      || pair.controlFlowAncestor
      || hasMixedCommentAndDirectiveTrivia(trivia, openLine, closeLine)) continue;

    const separators = pair.separators;
    if (separators.length === 0) continue;
    const separatorLines = separators.map(offset => lineIndexAt(sourceLines, offset));
    const allLeading = separatorLines.every((lineIndex, index) =>
      sourceLines[lineIndex].text.slice(0, separators[index] - sourceLines[lineIndex].start).trim() === '');
    if (allLeading) {
      alignLeadingSeparators(text, sourceLines, lines, pair, separatorLines, ctx);
      continue;
    }
    if (separatorLines.some((lineIndex, index) =>
      sourceLines[lineIndex].text.slice(separators[index] - sourceLines[lineIndex].start + 1).trim() !== '')) continue;

    const baseIndent = leadingWhitespace(lines[openLine].text);
    const itemIndent = resolveDetectedItemIndent(text, pair, baseIndent, ctx)
      ?? baseIndent + continuationIndent(ctx);
    const firstItemLine = nextCodeOrCommentLine(sourceLines, openLine + 1, closeLine, false);
    if (firstItemLine !== undefined) reindent(lines[firstItemLine], itemIndent);

    for (let i = 0; i < separators.length; i++) {
      const separatorLine = separatorLines[i];
      lines[separatorLine].text = lines[separatorLine].text.replace(/,\s*$/, '');
      const nextItemLine = nextCodeOrCommentLine(
        sourceLines,
        separatorLine + 1,
        closeLine,
        trivia.directivePrefix[closeLine] === trivia.directivePrefix[separatorLine + 1]);
      if (nextItemLine !== undefined) {
        reindent(lines[nextItemLine], itemIndent + ', ');
        reindentAttachedTrivia(sourceLines, lines, nextItemLine + 1, closeLine, itemIndent);
      }
    }

    const closeOffset = pair.close - sourceLines[closeLine].start;
    const contentBeforeClose = sourceLines[closeLine].text.slice(0, closeOffset).trim().replace(/^,\s*/, '');
    if (contentBeforeClose === '') {
      reindent(lines[closeLine], baseIndent);
    }
  }

  return joinLines(lines);
}

function resolveDetectedItemIndent(
  text: string,
  pair: CSharpListNode,
  baseIndent: string,
  ctx: PassContext
): string | undefined {
  if (ctx.continuationIndentMultiplier !== undefined) {
    return baseIndent + ctx.indentUnit.repeat(ctx.continuationIndentMultiplier);
  }
  if (ctx.preserveExistingLayout !== false && ctx.formattingIntent) {
    const signature = multilineListSignature(text, pair.open, pair.close);
    const intent = ctx.formattingIntent.multilineLists.find(value => value.signature === signature);
    if (intent) return appendIndentColumns(baseIndent, intent.continuationIndentColumns, ctx);
  }
  const detectedMultiplier = ctx.formattingIntent?.dominantListIndentMultiplier;
  return detectedMultiplier === undefined
    ? undefined
    : baseIndent + ctx.indentUnit.repeat(detectedMultiplier);
}

function appendIndentColumns(base: string, columns: number, ctx: PassContext): string {
  if (ctx.indentUnit === '\t') {
    const targetWidth = leadingWidth(base, ctx.tabSize) + columns;
    return '\t'.repeat(Math.floor(targetWidth / ctx.tabSize))
      + ' '.repeat(targetWidth % ctx.tabSize);
  }
  return base + ' '.repeat(columns);
}

function alignLeadingSeparators(
  text: string,
  sourceLines: { text: string; start: number; end: number }[],
  lines: { text: string; start: number; end: number }[],
  pair: CSharpListNode,
  separatorLines: number[],
  ctx: PassContext
): void {
  const openLine = lineIndexAt(sourceLines, pair.open);
  const closeLine = lineIndexAt(sourceLines, pair.close);
  const openOffset = pair.open - sourceLines[openLine].start;
  const firstItemIsInline = sourceLines[openLine].text.slice(openOffset + 1).trim() !== '';
  const firstItemLine = firstItemIsInline ? undefined : nextContentLine(sourceLines, openLine + 1, closeLine);
  const detected = resolveDetectedItemIndent(
    text,
    pair,
    leadingWhitespace(lines[openLine].text),
    ctx
  );
  const anchor = detected ?? (firstItemLine !== undefined
    ? leadingWhitespace(lines[firstItemLine].text)
    : leadingWhitespace(lines[separatorLines[0]].text));
  for (const lineIndex of separatorLines) {
    lines[lineIndex].text = anchor + lines[lineIndex].text.trimStart();
  }
}

interface TriviaIndex {
  commentPrefix: number[];
  directivePrefix: number[];
}

function buildTriviaIndex(lines: readonly { text: string }[]): TriviaIndex {
  const commentPrefix = new Array<number>(lines.length + 1).fill(0);
  const directivePrefix = new Array<number>(lines.length + 1).fill(0);
  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].text.trimStart();
    const comment = trimmed.startsWith('//')
      || trimmed.startsWith('/*')
      || trimmed.startsWith('*');
    commentPrefix[index + 1] = commentPrefix[index] + (comment ? 1 : 0);
    directivePrefix[index + 1] = directivePrefix[index] + (trimmed.startsWith('#') ? 1 : 0);
  }
  return { commentPrefix, directivePrefix };
}

function hasMixedCommentAndDirectiveTrivia(trivia: TriviaIndex, start: number, end: number): boolean {
  const comments = trivia.commentPrefix[end] - trivia.commentPrefix[start + 1];
  const directives = trivia.directivePrefix[end] - trivia.directivePrefix[start + 1];
  return comments > 0 && directives > 0;
}

function lineIndexAt(lines: readonly { start: number }[], offset: number): number {
  let low = 0;
  let high = lines.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].start <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high);
}

function nextContentLine(lines: { text: string }[], start: number, end: number): number | undefined {
  for (let i = start; i < end; i++) if (lines[i].text.trim()) return i;
  return undefined;
}

function nextCodeOrCommentLine(
  lines: readonly { text: string }[],
  start: number,
  end: number,
  allowComment: boolean
): number | undefined {
  for (let index = start; index < end; index++) {
    const trimmed = lines[index].text.trimStart();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (isCommentLine(trimmed) && !allowComment) continue;
    return index;
  }
  return undefined;
}

function reindentAttachedTrivia(
  sourceLines: readonly { text: string }[],
  lines: { text: string }[],
  start: number,
  end: number,
  indent: string
): void {
  for (let index = start; index < end; index++) {
    const trimmed = sourceLines[index].text.trimStart();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!isCommentLine(trimmed)) return;
    reindent(lines[index], indent);
  }
}

function isCommentLine(trimmed: string): boolean {
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
}

function reindent(line: { text: string }, indent: string): void {
  line.text = indent + line.text.trimStart().replace(/^,\s*/, '');
}
