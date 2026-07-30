import { buildCodeMask } from './csharpLexer';
import {
  buildCSharpFluentChainModel,
  fluentChainSignature
} from './csharpFluentChainModel';
import { analyzeCSharpStructure, buildCSharpListModel } from './csharpStructuralModel';
import { leadingWhitespace, leadingWidth, splitLines } from './textLines';

export class FluentChainIndentIntent {
  constructor(
    readonly signature: string,
    readonly continuationIndentColumns: number,
    readonly evidenceCount: number
  ) {}
}

export class FormattingIntentSnapshot {
  constructor(
    readonly fluentChains: readonly FluentChainIndentIntent[],
    readonly multilineLists: readonly MultilineListIndentIntent[],
    readonly dominantFluentIndentMultiplier?: number,
    readonly dominantListIndentMultiplier?: number
  ) {}
}

export class MultilineListIndentIntent {
  constructor(
    readonly signature: string,
    readonly continuationIndentColumns: number,
    readonly evidenceCount: number
  ) {}
}

export function detectFormattingIntent(text: string, tabSize: number): FormattingIntentSnapshot {
  const lines = splitLines(text);
  const intents: FluentChainIndentIntent[] = [];
  const fluentMultiplierCounts = new Map<number, number>();

  for (const chain of buildCSharpFluentChainModel(text)) {
    const widths = chain.continuationLines.map(line =>
      leadingWidth(leadingWhitespace(lines[line].text), tabSize));
    const continuationWidth = widths[0];
    const rootWidth = chain.rootLine === undefined
      ? undefined
      : leadingWidth(leadingWhitespace(lines[chain.rootLine].text), tabSize);
    const consistent = continuationWidth !== undefined
      && widths.every(width => width === continuationWidth);
    const delta = rootWidth === undefined ? undefined : continuationWidth - rootWidth;

    if (consistent && delta !== undefined && delta > 0) {
      intents.push(new FluentChainIndentIntent(
        fluentChainSignature(lines.map(line => line.text), chain.continuationLines),
        delta,
        chain.continuationLines.length
      ));
      if (delta % tabSize === 0) {
        const multiplier = delta / tabSize;
        fluentMultiplierCounts.set(multiplier, (fluentMultiplierCounts.get(multiplier) ?? 0) + 1);
      }
    }
  }

  const listDetection = detectMultilineListIntents(text, tabSize);
  return new FormattingIntentSnapshot(
    intents,
    listDetection.intents,
    dominantMultiplier(fluentMultiplierCounts),
    dominantMultiplier(listDetection.multiplierCounts)
  );
}

export function multilineListSignature(text: string, open: number, close: number): string {
  return analyzeCSharpStructure(text.slice(open, close + 1)).semanticFingerprint;
}

class MultilineListDetection {
  constructor(
    readonly intents: MultilineListIndentIntent[],
    readonly multiplierCounts: Map<number, number>
  ) {}
}

function detectMultilineListIntents(text: string, tabSize: number): MultilineListDetection {
  const mask = buildCodeMask(text);
  const lines = splitLines(text);
  const intents: MultilineListIndentIntent[] = [];
  const multiplierCounts = new Map<number, number>();

  for (const list of buildCSharpListModel(text, mask)) {
    if (list.controlFlowAncestor) continue;
    const openLine = lineIndexAt(lines, list.open);
    const closeLine = lineIndexAt(lines, list.close);
    if (openLine === closeLine || list.separators.length === 0) continue;
    const boundaries = [list.open, ...list.separators, list.close];
    const itemLines: number[] = [];
    for (let index = 0; index < boundaries.length - 1; index++) {
      const itemStart = nextCodeOffset(text, mask, boundaries[index] + 1, boundaries[index + 1]);
      if (itemStart === undefined) continue;
      const line = lineIndexAt(lines, itemStart);
      if (line > openLine && line < closeLine && !itemLines.includes(line)) itemLines.push(line);
    }
    if (itemLines.length === 0) continue;

    const widths = itemLines.map(line =>
      leadingWidth(leadingWhitespace(lines[line].text), tabSize));
    const itemWidth = widths[0];
    const baseWidth = leadingWidth(leadingWhitespace(lines[openLine].text), tabSize);
    const delta = itemWidth - baseWidth;
    if (delta <= 0 || !widths.every(width => width === itemWidth)) continue;

    intents.push(new MultilineListIndentIntent(
      multilineListSignature(text, list.open, list.close),
      delta,
      itemLines.length
    ));
    if (delta % tabSize === 0) {
      const multiplier = delta / tabSize;
      multiplierCounts.set(multiplier, (multiplierCounts.get(multiplier) ?? 0) + 1);
    }
  }
  return new MultilineListDetection(intents, multiplierCounts);
}

function dominantMultiplier(counts: ReadonlyMap<number, number>): number | undefined {
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0]);
  if (ranked.length === 0) return undefined;
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return undefined;
  const total = ranked.reduce((sum, item) => sum + item[1], 0);
  return ranked[0][1] >= 2 && ranked[0][1] / total >= 0.6 ? ranked[0][0] : undefined;
}

function nextCodeOffset(
  text: string,
  mask: readonly boolean[],
  start: number,
  end: number
): number | undefined {
  for (let index = start; index < end; index++) {
    if (mask[index] && !/\s/.test(text[index]) && text[index] !== ',') return index;
  }
  return undefined;
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
