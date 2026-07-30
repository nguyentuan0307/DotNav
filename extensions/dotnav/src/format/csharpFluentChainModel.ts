import { buildCodeMask } from './csharpLexer';
import { analyzeCSharpStructure } from './csharpStructuralModel';
import { splitLines } from './textLines';

export class CSharpFluentChainNode {
  constructor(
    readonly rootLine: number | undefined,
    readonly continuationLines: readonly number[],
    readonly attachedCommentLines: readonly number[],
    readonly delimiterPath: string
  ) {}
}

class FluentLineInfo {
  constructor(
    readonly delimiterPath: string,
    readonly firstCodeCharacter: string | undefined,
    readonly continuation: boolean,
    readonly trivia: boolean
  ) {}
}

export function buildCSharpFluentChainModel(text: string): CSharpFluentChainNode[] {
  const lines = splitLines(text);
  const info = buildLineInfo(text);
  const assigned = new Set<number>();
  const nodes: CSharpFluentChainNode[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const first = info[lineIndex];
    if (!first.continuation || assigned.has(lineIndex)) continue;

    const delimiterPath = first.delimiterPath;
    const continuationLines: number[] = [];
    const attachedCommentLines: number[] = [];

    for (let cursor = lineIndex; cursor < lines.length; cursor++) {
      const current = info[cursor];
      if (current.continuation && current.delimiterPath === delimiterPath) {
        continuationLines.push(cursor);
        assigned.add(cursor);
        continue;
      }
      if (current.trivia) {
        if (current.delimiterPath === delimiterPath && isCommentLine(lines[cursor].text.trimStart())) {
          attachedCommentLines.push(cursor);
        }
        continue;
      }
      if (isNestedPath(current.delimiterPath, delimiterPath)) continue;
      break;
    }

    nodes.push(new CSharpFluentChainNode(
      findRootLine(lines.map(line => line.text), info, lineIndex, delimiterPath),
      continuationLines,
      attachedCommentLines,
      delimiterPath
    ));
  }

  return nodes;
}

export function fluentChainSignature(lines: readonly string[], indexes: readonly number[]): string {
  return indexes
    .map(index => analyzeCSharpStructure(lines[index].trimStart()).semanticFingerprint)
    .join('\u0003');
}

function buildLineInfo(text: string): FluentLineInfo[] {
  const mask = buildCodeMask(text);
  const lines = splitLines(text);
  const stack: string[] = [];
  const result: FluentLineInfo[] = [];

  for (const line of lines) {
    const lineStartPath = stack.join('');
    let firstCodeCharacter: string | undefined;
    let firstCodePath = lineStartPath;
    let firstCodeOffset = -1;

    for (let offset = line.start; offset < line.end; offset++) {
      if (!mask[offset]) continue;
      const character = text[offset];
      if (firstCodeCharacter === undefined && !/\s/.test(character)) {
        firstCodeCharacter = character;
        firstCodePath = stack.join('');
        firstCodeOffset = offset;
      }
      updateStack(stack, character);
    }

    const trimmed = line.text.trimStart();
    const continuation = firstCodeOffset >= 0
      && ((firstCodeCharacter === '.' && mask[firstCodeOffset])
        || (firstCodeCharacter === '?'
          && text[firstCodeOffset + 1] === '.'
          && mask[firstCodeOffset + 1]));
    const trivia = !trimmed
      || isCommentLine(trimmed)
      || trimmed.startsWith('#')
      || firstCodeCharacter === undefined;
    result.push(new FluentLineInfo(firstCodePath, firstCodeCharacter, continuation, trivia));
  }

  return result;
}

function updateStack(stack: string[], character: string): void {
  if (character === '(' || character === '[' || character === '{') {
    stack.push(character);
    return;
  }
  const expected = character === ')' ? '(' : character === ']' ? '[' : character === '}' ? '{' : undefined;
  if (expected === undefined) return;
  if (stack[stack.length - 1] === expected) stack.pop();
}

function findRootLine(
  lines: readonly string[],
  info: readonly FluentLineInfo[],
  continuationLine: number,
  delimiterPath: string
): number | undefined {
  for (let cursor = continuationLine - 1; cursor >= 0; cursor--) {
    const current = info[cursor];
    if (current.trivia || isNestedPath(current.delimiterPath, delimiterPath)) continue;
    if (current.delimiterPath !== delimiterPath || current.continuation) return undefined;
    const trimmed = lines[cursor].trimEnd();
    return /[;{}]\s*$/.test(trimmed) ? undefined : cursor;
  }
  return undefined;
}

function isNestedPath(candidate: string, parent: string): boolean {
  return candidate.length > parent.length && candidate.startsWith(parent);
}

function isCommentLine(trimmed: string): boolean {
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
}
