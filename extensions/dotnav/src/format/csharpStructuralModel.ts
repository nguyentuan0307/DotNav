import { buildCodeMask, classifySpans } from './csharpLexer';

export class CSharpListNode {
  constructor(
    readonly open: number,
    readonly close: number,
    readonly separators: readonly number[],
    readonly controlFlowAncestor: boolean
  ) {}
}

export class CSharpStructuralModel {
  constructor(
    readonly lists: readonly CSharpListNode[],
    readonly delimiterBalance: string,
    readonly semanticFingerprint: string,
    readonly fragmentBoundaryCompatible: boolean
  ) {}
}

class StructuralScan {
  constructor(
    readonly lists: CSharpListNode[],
    readonly delimiterBalance: string,
    readonly fragmentBoundaryCompatible: boolean
  ) {}
}

class ListFrame {
  readonly separators: number[] = [];

  constructor(
    readonly open: number,
    readonly controlFlowAncestor: boolean,
    readonly bracketDepth: number,
    readonly braceDepth: number,
    readonly angleDepth: number
  ) {}
}

export function buildCSharpListModel(text: string, mask = buildCodeMask(text)): CSharpListNode[] {
  return scanCSharpLists(text, mask).lists;
}

export function analyzeCSharpStructure(
  text: string,
  mask = buildCodeMask(text)
): CSharpStructuralModel {
  const scan = scanCSharpLists(text, mask);
  return new CSharpStructuralModel(
    scan.lists,
    scan.delimiterBalance,
    semanticFingerprint(text),
    scan.fragmentBoundaryCompatible
  );
}

function scanCSharpLists(
  text: string,
  mask: readonly boolean[]
): StructuralScan {
  const frames: ListFrame[] = [];
  const nodes: CSharpListNode[] = [];
  let bracketDepth = 0;
  let braceDepth = 0;
  let angleDepth = 0;
  let unmatchedParens = 0;
  let unmatchedBrackets = 0;
  let unmatchedBraces = 0;
  let unsafeBoundaryClosers = 0;

  for (let index = 0; index < text.length; index++) {
    if (!mask[index]) continue;
    const ch = text[index];
    if (ch === '(') {
      const parent = frames[frames.length - 1];
      const controlFlowAncestor = (parent?.controlFlowAncestor ?? false) || isControlFlow(text, index);
      frames.push(new ListFrame(index, controlFlowAncestor, bracketDepth, braceDepth, angleDepth));
      continue;
    }
    if (ch === ')') {
      const frame = frames.pop();
      if (frame) {
        nodes.push(new CSharpListNode(frame.open, index, frame.separators, frame.controlFlowAncestor));
      } else unmatchedParens++;
      continue;
    }
    if (ch === '[') bracketDepth++;
    else if (ch === ']') {
      if (bracketDepth > 0) bracketDepth--;
      else unmatchedBrackets++;
    }
    else if (ch === '{') braceDepth++;
    else if (ch === '}') {
      if (braceDepth > 0) braceDepth--;
      else {
        unmatchedBraces++;
        if (frames.length > 0) unsafeBoundaryClosers++;
      }
    }
    else if (ch === '<' && looksLikeGenericOpen(text, mask, index)) angleDepth++;
    else if (ch === '>' && angleDepth > 0) angleDepth--;
    else if (ch === ',') {
      const frame = frames[frames.length - 1];
      if (frame
        && bracketDepth === frame.bracketDepth
        && braceDepth === frame.braceDepth
        && angleDepth === frame.angleDepth) {
        frame.separators.push(index);
      }
    }
  }

  const delimiterBalance = [
      frames.length, unmatchedParens,
      bracketDepth, unmatchedBrackets,
      braceDepth, unmatchedBraces,
      angleDepth
    ].join(':');
  const fragmentBoundaryCompatible = frames.length === 0
    && unmatchedParens === 0
    && bracketDepth === 0
    && unmatchedBrackets === 0
    && braceDepth === 0
    && angleDepth === 0
    && unsafeBoundaryClosers === 0;
  return new StructuralScan(nodes, delimiterBalance, fragmentBoundaryCompatible);
}

function looksLikeGenericOpen(text: string, mask: readonly boolean[], index: number): boolean {
  if (!/[\w)>\]]/.test(text[index - 1] ?? '') || !/[\w@[(]/.test(text[index + 1] ?? '')) {
    return false;
  }

  let depth = 1;
  for (let cursor = index + 1; cursor < text.length; cursor++) {
    if (!mask[cursor]) continue;
    const ch = text[cursor];
    if (ch === '<') depth++;
    else if (ch === '>') {
      depth--;
      if (depth === 0) {
        const next = nextCodeCharacter(text, mask, cursor + 1);
        return next === undefined
          || !/[\w@]/.test(next.character)
          || next.index > cursor + 1;
      }
    } else if (depth === 1 && /[);={}]/.test(ch)) {
      return true;
    }
  }
  return true;
}

function nextCodeCharacter(
  text: string,
  mask: readonly boolean[],
  start: number
): { index: number; character: string } | undefined {
  for (let index = start; index < text.length; index++) {
    if (mask[index] && !/\s/.test(text[index])) {
      return { index, character: text[index] };
    }
  }
  return undefined;
}

function isControlFlow(text: string, open: number): boolean {
  let end = open - 1;
  while (end >= 0 && /\s/.test(text[end])) end--;
  if (end < 0 || !/\w/.test(text[end])) return false;
  let start = end;
  while (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1])) start--;
  return CONTROL_KEYWORDS.has(text.slice(start, end + 1));
}

const CONTROL_KEYWORDS = new Set([
  'if', 'while', 'for', 'foreach', 'switch', 'catch', 'using', 'lock', 'fixed', 'return'
]);

function semanticFingerprint(text: string): string {
  const directiveMask = buildDirectiveMask(text);
  let result = '';
  let trivia = '';
  for (const span of classifySpans(text)) {
    if (span.kind === 'lineComment' || span.kind === 'blockComment') {
      trivia += `\u0001${span.kind}:${text.slice(span.start, span.end).trimStart()}`;
      continue;
    }
    const value = text.slice(span.start, span.end);
    if (span.kind !== 'code' && span.kind !== 'interpolationHole') {
      result += `\u0000${span.kind}:${value}\u0000`;
      continue;
    }
    for (let offset = span.start; offset < span.end; offset++) {
      if (!directiveMask[offset] && !/\s/.test(text[offset])) result += text[offset];
    }
  }
  const directives = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('#'))
    .join('\u0001');
  return `${result}\u0002${trivia}\u0002${directives}`;
}

function buildDirectiveMask(text: string): boolean[] {
  const mask = new Array<boolean>(text.length).fill(false);
  let lineStart = 0;
  while (lineStart < text.length) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = text.length;
    const line = text.slice(lineStart, lineEnd);
    if (line.trimStart().startsWith('#')) {
      for (let index = lineStart; index < lineEnd; index++) mask[index] = true;
    }
    lineStart = lineEnd + 1;
  }
  return mask;
}
