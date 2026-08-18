import { buildCodeMask } from '../csharpLexer';
import { analyzeCSharpStructure } from '../csharpStructuralModel';
import { joinLines, leadingWhitespace, splitLines } from '../textLines';
import { continuationIndent } from './continuationIndent';
import { PassContext } from './types';

export function formatTernaryExpressions(text: string, ctx: PassContext): string {
  const before = analyzeCSharpStructure(text);
  const canFormat = before.delimiterBalance === '0:0:0:0:0:0:0'
    || ctx.allowPartialFragment === true
    || before.fragmentBoundaryCompatible
    || before.delimiterBalance.startsWith('0:0:0:0:');
  if (!canFormat) {
    return text;
  }

  const mask = buildCodeMask(text);
  const lines = splitLines(text);
  const info = buildTernaryLineInfo(lines, text, mask);

  const ternaryPairs: Array<{ questionLine: number; colonLine: number; rootLine?: number }> = [];
  const questionStack: Array<{ lineIndex: number; depth: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const current = info[i];
    if (current.isQuestion) {
      questionStack.push({ lineIndex: i, depth: current.delimiterDepth });
    } else if (current.isColon) {
      const matchIndex = findMatchingQuestion(questionStack, current.delimiterDepth);
      if (matchIndex >= 0) {
        const question = questionStack.splice(matchIndex, 1)[0];
        const rootLine = findTernaryRootLine(lines, info, question.lineIndex - 1, current.delimiterDepth);
        ternaryPairs.push({ questionLine: question.lineIndex, colonLine: i, rootLine });
      }
    }
  }

  if (ternaryPairs.length === 0) return text;

  for (const pair of ternaryPairs) {
    const rootIndent = pair.rootLine !== undefined
      ? leadingWhitespace(lines[pair.rootLine].text)
      : leadingWhitespace(lines[pair.questionLine].text);
    const targetIndent = pair.rootLine !== undefined
      ? rootIndent + continuationIndent(ctx)
      : leadingWhitespace(lines[pair.questionLine].text);

    lines[pair.questionLine].text = targetIndent + lines[pair.questionLine].text.trimStart();
    lines[pair.colonLine].text = targetIndent + lines[pair.colonLine].text.trimStart();
  }

  const formatted = joinLines(lines);
  const after = analyzeCSharpStructure(formatted);
  return before.delimiterBalance === after.delimiterBalance
    && before.semanticFingerprint === after.semanticFingerprint
    ? formatted
    : text;
}

interface TernaryLineInfo {
  delimiterDepth: number;
  isQuestion: boolean;
  isColon: boolean;
  isComment: boolean;
}

function buildTernaryLineInfo(
  lines: readonly { text: string; start: number; end: number }[],
  text: string,
  mask: readonly boolean[]
): TernaryLineInfo[] {
  const result: TernaryLineInfo[] = [];
  let depth = 0;

  for (const line of lines) {
    const trimmed = line.text.trimStart();
    const offset = line.text.length - trimmed.length;
    const isComment = trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');

    const firstChar = text[line.start + offset];
    const secondChar = text[line.start + offset + 1];
    const isCode = mask[line.start + offset] === true;

    const isQuestion = isCode && firstChar === '?' && secondChar !== '.' && secondChar !== '?';
    const isColon = isCode && firstChar === ':' && secondChar !== ':';

    result.push({ delimiterDepth: depth, isQuestion, isColon, isComment });

    for (let i = line.start; i < line.end; i++) {
      if (!mask[i]) continue;
      const ch = text[i];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    }
  }

  return result;
}

function findMatchingQuestion(
  stack: readonly { lineIndex: number; depth: number }[],
  targetDepth: number
): number {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].depth === targetDepth) return i;
  }
  return -1;
}

function findTernaryRootLine(
  lines: readonly { text: string }[],
  info: readonly TernaryLineInfo[],
  start: number,
  targetDepth: number
): number | undefined {
  for (let cursor = start; cursor >= 0; cursor--) {
    const current = info[cursor];
    if (current.isComment || current.isQuestion || current.isColon) continue;
    if (current.delimiterDepth <= targetDepth) {
      const trimmed = lines[cursor].text.trim();
      if (trimmed && !trimmed.startsWith('#')) return cursor;
    }
  }
  return undefined;
}
