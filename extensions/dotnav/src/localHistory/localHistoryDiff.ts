export type LocalHistoryPatchLineKind = 'context' | 'add' | 'del';

export interface LocalHistoryPatchLine {
  readonly kind: LocalHistoryPatchLineKind;
  readonly oldLine?: number;
  readonly newLine?: number;
  readonly text: string;
}

export interface LocalHistoryPatchHunk {
  readonly header: string;
  readonly lines: LocalHistoryPatchLine[];
}

interface DiffOperation {
  readonly kind: 'equal' | 'insert' | 'delete';
  readonly text: string;
}

interface NumberedOperation extends DiffOperation {
  readonly oldLine?: number;
  readonly newLine?: number;
}

const maximumMyersEditDistance = 800;

export function createLocalHistoryPatch(
  previousContent: string,
  revisionContent: string,
  contextLineCount = 3
): LocalHistoryPatchHunk[] {
  const previousLines = splitLines(previousContent);
  const revisionLines = splitLines(revisionContent);
  const operations = numberOperations(diffLines(previousLines, revisionLines));
  const changedIndexes = operations
    .map((operation, index) => operation.kind === 'equal' ? -1 : index)
    .filter(index => index >= 0);
  if (changedIndexes.length === 0) {
    return [];
  }

  const ranges: { start: number; end: number }[] = [];
  for (const changedIndex of changedIndexes) {
    const start = Math.max(0, changedIndex - contextLineCount);
    const end = Math.min(operations.length, changedIndex + contextLineCount + 1);
    const previousRange = ranges[ranges.length - 1];
    if (previousRange && start <= previousRange.end) {
      previousRange.end = Math.max(previousRange.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  return ranges.map(range => createHunk(operations.slice(range.start, range.end)));
}

function createHunk(operations: readonly NumberedOperation[]): LocalHistoryPatchHunk {
  const oldLines = operations.filter(operation => operation.kind !== 'insert');
  const newLines = operations.filter(operation => operation.kind !== 'delete');
  const oldStart = oldLines[0]?.oldLine ?? insertionStart(operations, 'oldLine');
  const newStart = newLines[0]?.newLine ?? insertionStart(operations, 'newLine');
  return {
    header: `@@ -${formatRange(oldStart, oldLines.length)} +${formatRange(newStart, newLines.length)} @@`,
    lines: operations.map(operation => ({
      kind: operation.kind === 'equal' ? 'context' : operation.kind === 'insert' ? 'add' : 'del',
      oldLine: operation.oldLine,
      newLine: operation.newLine,
      text: operation.text
    }))
  };
}

function insertionStart(
  operations: readonly NumberedOperation[],
  field: 'oldLine' | 'newLine'
): number {
  const value = operations.find(operation => operation[field] !== undefined)?.[field];
  return value === undefined ? 0 : Math.max(0, value - 1);
}

function formatRange(start: number, count: number): string {
  return count === 1 ? String(start) : `${start},${count}`;
}

function numberOperations(operations: readonly DiffOperation[]): NumberedOperation[] {
  let oldLine = 1;
  let newLine = 1;
  return operations.map(operation => {
    if (operation.kind === 'equal') {
      return { ...operation, oldLine: oldLine++, newLine: newLine++ };
    }
    if (operation.kind === 'delete') {
      return { ...operation, oldLine: oldLine++ };
    }
    return { ...operation, newLine: newLine++ };
  });
}

function diffLines(previousLines: readonly string[], revisionLines: readonly string[]): DiffOperation[] {
  if (previousLines.length === 0) {
    return revisionLines.map(text => ({ kind: 'insert', text }));
  }
  if (revisionLines.length === 0) {
    return previousLines.map(text => ({ kind: 'delete', text }));
  }

  const trace: Map<number, number>[] = [];
  const furthest = new Map<number, number>([[1, 0]]);
  const maximumDistance = previousLines.length + revisionLines.length;
  const traceDistance = Math.min(maximumDistance, maximumMyersEditDistance);

  for (let distance = 0; distance <= traceDistance; distance++) {
    trace.push(new Map(furthest));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down = furthest.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY;
      const right = furthest.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY;
      let oldIndex = diagonal === -distance || (diagonal !== distance && right < down)
        ? down
        : right + 1;
      if (!Number.isFinite(oldIndex)) {
        oldIndex = 0;
      }
      let newIndex = oldIndex - diagonal;
      while (oldIndex < previousLines.length
        && newIndex < revisionLines.length
        && previousLines[oldIndex] === revisionLines[newIndex]) {
        oldIndex += 1;
        newIndex += 1;
      }
      furthest.set(diagonal, oldIndex);
      if (oldIndex >= previousLines.length && newIndex >= revisionLines.length) {
        return backtrack(trace, previousLines, revisionLines, distance);
      }
    }
  }

  return [
    ...previousLines.map(text => ({ kind: 'delete' as const, text })),
    ...revisionLines.map(text => ({ kind: 'insert' as const, text }))
  ];
}

function backtrack(
  trace: readonly Map<number, number>[],
  previousLines: readonly string[],
  revisionLines: readonly string[],
  maximumDistance: number
): DiffOperation[] {
  const operations: DiffOperation[] = [];
  let oldIndex = previousLines.length;
  let newIndex = revisionLines.length;

  for (let distance = maximumDistance; distance >= 0; distance--) {
    const furthest = trace[distance];
    const diagonal = oldIndex - newIndex;
    const down = furthest.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY;
    const right = furthest.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY;
    const previousDiagonal = diagonal === -distance || (diagonal !== distance && right < down)
      ? diagonal + 1
      : diagonal - 1;
    const previousOldIndex = furthest.get(previousDiagonal) ?? 0;
    const previousNewIndex = previousOldIndex - previousDiagonal;

    while (oldIndex > previousOldIndex && newIndex > previousNewIndex) {
      operations.push({ kind: 'equal', text: previousLines[oldIndex - 1] });
      oldIndex -= 1;
      newIndex -= 1;
    }
    if (distance === 0) {
      break;
    }
    if (oldIndex === previousOldIndex) {
      operations.push({ kind: 'insert', text: revisionLines[newIndex - 1] });
      newIndex -= 1;
    } else {
      operations.push({ kind: 'delete', text: previousLines[oldIndex - 1] });
      oldIndex -= 1;
    }
  }

  return operations.reverse();
}

function splitLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }
  const lines = content.split(/\r?\n/);
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}
