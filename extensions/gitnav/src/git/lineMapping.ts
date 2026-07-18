export interface HeadLineRange {
  readonly start: number;
  readonly end: number;
}

interface DiffHunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
}

const hunkHeaderRegex = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function mapWorktreeRangeToHead(diffU0: string, start: number, end: number): HeadLineRange | undefined {
  const hunks = parseDiffHunks(diffU0);
  const mappedLines: number[] = [];

  for (let line = start; line <= end; line++) {
    const mapped = mapWorktreeLineToHead(hunks, line);
    if (mapped !== undefined) {
      mappedLines.push(mapped);
    }
  }

  if (mappedLines.length === 0) {
    return undefined;
  }

  return {
    start: Math.min(...mappedLines),
    end: Math.max(...mappedLines)
  };
}

export function mapRevisionLineToWorktree(diffU0: string, line: number): number {
  const hunks = parseDiffHunks(diffU0).sort((a, b) => a.oldStart - b.oldStart);
  let delta = 0;

  for (const hunk of hunks) {
    if (line < hunk.oldStart) {
      break;
    }

    if (line < hunk.oldStart + hunk.oldCount) {
      if (hunk.newCount === 0) {
        return Math.max(1, hunk.newStart);
      }
      return hunk.newStart + Math.min(line - hunk.oldStart, hunk.newCount - 1);
    }

    delta += hunk.newCount - hunk.oldCount;
  }

  return Math.max(1, line + delta);
}

export function parseDiffHunks(diffU0: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  for (const line of diffU0.split(/\r?\n/)) {
    const match = hunkHeaderRegex.exec(line);
    if (!match) {
      continue;
    }

    hunks.push({
      oldStart: Number(match[1]),
      oldCount: match[2] === undefined ? 1 : Number(match[2]),
      newStart: Number(match[3]),
      newCount: match[4] === undefined ? 1 : Number(match[4])
    });
  }

  return hunks.sort((a, b) => a.newStart - b.newStart);
}

function mapWorktreeLineToHead(hunks: DiffHunk[], line: number): number | undefined {
  let delta = 0;

  for (const hunk of hunks) {
    if (line < hunk.newStart) {
      break;
    }

    if (line < hunk.newStart + hunk.newCount) {
      return undefined;
    }

    delta += hunk.oldCount - hunk.newCount;
  }

  return line + delta;
}
