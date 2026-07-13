// Adapted from Jet Git (MIT), Copyright (c) 2026 Congcong Zhang.
import { GitCommitSummary, GitGraphLane, GitGraphLine, GitGraphSnapshot } from './gitPanelModels';

export interface GitGraphLayoutResult {
  readonly lanes: Record<string, GitGraphLane>;
  readonly snapshot: GitGraphSnapshot;
}

export function computeGraphLayout(commits: GitCommitSummary[], previous?: GitGraphSnapshot): GitGraphLayoutResult {
  const activeLanes = previous ? [...previous.activeLanes] : [];
  const laneColors = previous ? [...previous.laneColors] : [];
  let nextColor = previous?.nextColor ?? 0;
  const lanes: Record<string, GitGraphLane> = {};

  for (const commit of commits) {
    let column = activeLanes.indexOf(commit.hash);
    if (column < 0) {
      column = findFreeLane(activeLanes, laneColors);
      activeLanes[column] = commit.hash;
    }
    if (laneColors[column] == null) laneColors[column] = nextColor++ % 8;
    const color = laneColors[column] ?? 0;
    const lines: GitGraphLine[] = [];
    if (!commit.parents.length) {
      activeLanes[column] = null;
      laneColors[column] = null;
    } else {
      const firstParent = commit.parents[0];
      const existing = activeLanes.indexOf(firstParent);
      if (existing >= 0 && existing !== column) {
        lines.push({ fromColumn: column, toColumn: existing, toCommit: firstParent });
        activeLanes[column] = null;
        laneColors[column] = null;
      } else {
        activeLanes[column] = firstParent;
        lines.push({ fromColumn: column, toColumn: column, toCommit: firstParent });
      }
      for (const parent of commit.parents.slice(1)) {
        let parentColumn = activeLanes.indexOf(parent);
        if (parentColumn < 0) {
          parentColumn = findFreeLane(activeLanes, laneColors);
          activeLanes[parentColumn] = parent;
          laneColors[parentColumn] = nextColor++ % 8;
        }
        lines.push({ fromColumn: column, toColumn: parentColumn, toCommit: parent });
      }
    }
    lanes[commit.hash] = { column, color, lines };
  }
  while (activeLanes.at(-1) === null) {
    activeLanes.pop();
    laneColors.pop();
  }
  return { lanes, snapshot: { activeLanes, laneColors, nextColor } };
}

function findFreeLane(activeLanes: Array<string | null>, colors: Array<number | null>): number {
  const free = activeLanes.indexOf(null);
  if (free >= 0) return free;
  activeLanes.push(null);
  colors.push(null);
  return activeLanes.length - 1;
}
