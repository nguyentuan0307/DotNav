import { buildCodeMask } from '../csharpLexer';
import { analyzeCSharpStructure } from '../csharpStructuralModel';
import { joinLines, leadingWhitespace, splitLines } from '../textLines';
import { continuationIndent } from './continuationIndent';
import { PassContext } from './types';

export function formatBinaryExpressions(text: string, ctx: PassContext): string {
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
  const info = buildBinaryLineInfo(lines, text, mask);

  let index = 0;
  while (index < lines.length) {
    if (!info[index].isBinaryOp) {
      index++;
      continue;
    }

    const chainStart = index;
    const targetDepth = info[index].delimiterDepth;
    const continuationLines: number[] = [];
    const attachedComments: number[] = [];

    while (index < lines.length) {
      const current = info[index];
      if (current.isBinaryOp && current.delimiterDepth === targetDepth) {
        continuationLines.push(index);
        index++;
      } else if (current.isComment && current.delimiterDepth === targetDepth) {
        attachedComments.push(index);
        index++;
      } else if (current.delimiterDepth > targetDepth) {
        index++;
      } else {
        break;
      }
    }

    if (continuationLines.length === 0) continue;

    const rootLine = findBinaryRootLine(lines, info, chainStart - 1, targetDepth);
    const rootIndent = rootLine !== undefined
      ? leadingWhitespace(lines[rootLine].text)
      : leadingWhitespace(lines[chainStart].text);
    const targetIndent = rootLine !== undefined
      ? rootIndent + continuationIndent(ctx)
      : leadingWhitespace(lines[chainStart].text);

    for (const lineIndex of [...continuationLines, ...attachedComments]) {
      lines[lineIndex].text = targetIndent + lines[lineIndex].text.trimStart();
    }
  }

  const formatted = joinLines(lines);
  const after = analyzeCSharpStructure(formatted);
  return before.delimiterBalance === after.delimiterBalance
    && before.semanticFingerprint === after.semanticFingerprint
    ? formatted
    : text;
}

interface BinaryLineInfo {
  delimiterDepth: number;
  isBinaryOp: boolean;
  isComment: boolean;
}

function buildBinaryLineInfo(
  lines: readonly { text: string; start: number; end: number }[],
  text: string,
  mask: readonly boolean[]
): BinaryLineInfo[] {
  const result: BinaryLineInfo[] = [];
  let depth = 0;

  for (const line of lines) {
    const trimmed = line.text.trimStart();
    const offset = line.text.length - trimmed.length;
    const isComment = trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
    const firstTwo = text.slice(line.start + offset, line.start + offset + 2);
    const isBinaryOp = (firstTwo === '&&' || firstTwo === '||') && mask[line.start + offset] === true;

    result.push({ delimiterDepth: depth, isBinaryOp, isComment });

    for (let i = line.start; i < line.end; i++) {
      if (!mask[i]) continue;
      const ch = text[i];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    }
  }

  return result;
}

function findBinaryRootLine(
  lines: readonly { text: string }[],
  info: readonly BinaryLineInfo[],
  start: number,
  targetDepth: number
): number | undefined {
  for (let cursor = start; cursor >= 0; cursor--) {
    const current = info[cursor];
    if (current.isComment || current.isBinaryOp) continue;
    if (current.delimiterDepth <= targetDepth) {
      const trimmed = lines[cursor].text.trim();
      if (trimmed && !trimmed.startsWith('#')) return cursor;
    }
  }
  return undefined;
}
