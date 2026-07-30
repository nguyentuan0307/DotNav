import {
  buildCSharpFluentChainModel,
  fluentChainSignature
} from '../csharpFluentChainModel';
import { joinLines, leadingWhitespace, leadingWidth, splitLines } from '../textLines';
import { PassContext } from './types';

export function formatFluentChains(text: string, ctx: PassContext): string {
  const lines = splitLines(text);
  const sourceLines = lines.map(value => value.text);

  for (const chain of buildCSharpFluentChainModel(text)) {
    if (chain.continuationLines.length < ctx.fluentChainMinSegments) continue;
    const firstContinuation = chain.continuationLines[0];
    const rootIndent = chain.rootLine === undefined
      ? undefined
      : leadingWhitespace(lines[chain.rootLine].text);
    const targetIndent = resolveTargetIndent(
      sourceLines,
      chain.continuationLines,
      rootIndent,
      leadingWhitespace(lines[firstContinuation].text),
      ctx
    );
    for (const lineIndex of [...chain.continuationLines, ...chain.attachedCommentLines]) {
      lines[lineIndex].text = targetIndent + lines[lineIndex].text.trimStart();
    }
  }

  return joinLines(lines);
}

function resolveTargetIndent(
  lines: readonly string[],
  continuationLines: readonly number[],
  previousIndent: string | undefined,
  currentIndent: string,
  ctx: PassContext
): string {
  if (previousIndent === undefined) return currentIndent;
  if (ctx.continuationIndentMultiplier !== undefined) {
    return previousIndent + ctx.indentUnit.repeat(ctx.continuationIndentMultiplier);
  }

  if (ctx.preserveExistingLayout !== false && ctx.formattingIntent) {
    const signature = fluentChainSignature(lines, continuationLines);
    const intent = ctx.formattingIntent.fluentChains.find(value => value.signature === signature);
    if (intent) {
      return appendIndentColumns(previousIndent, intent.continuationIndentColumns, ctx);
    }
  }

  const detectedMultiplier = ctx.formattingIntent?.dominantFluentIndentMultiplier;
  return previousIndent + ctx.indentUnit.repeat(detectedMultiplier ?? 1);
}

function appendIndentColumns(base: string, columns: number, ctx: PassContext): string {
  if (ctx.indentUnit === '\t') {
    const baseWidth = leadingWidth(base, ctx.tabSize);
    const targetWidth = baseWidth + columns;
    const tabs = Math.floor(targetWidth / ctx.tabSize);
    const spaces = targetWidth % ctx.tabSize;
    return '\t'.repeat(tabs) + ' '.repeat(spaces);
  }
  return base + ' '.repeat(columns);
}
