import { SmartBuildPlan } from './types';

export interface SmartBuildMetrics {
  readonly evaluationMs: number;
  readonly planningMs: number;
  readonly copyMs: number;
  readonly msbuildMs: number;
  readonly stateCaptureMs: number;
  readonly totalMs: number;
  readonly builtProjects: number;
  readonly copiedFiles: number;
  readonly copyFailures: number;
  readonly stateFound: boolean;
  readonly restoreRequired: boolean;
  readonly binaryLogPath?: string;
}

export function metricsSummary(metrics: SmartBuildMetrics): string {
  return [
    `total=${formatMs(metrics.totalMs)}`,
    `evaluate=${formatMs(metrics.evaluationMs)}`,
    `plan/hash=${formatMs(metrics.planningMs)}`,
    `copy=${formatMs(metrics.copyMs)}`,
    `msbuild=${formatMs(metrics.msbuildMs)}`,
    `state=${formatMs(metrics.stateCaptureMs)}`,
    `built=${metrics.builtProjects}`,
    `copied=${metrics.copiedFiles}`,
    `cache=${metrics.stateFound ? 'warm' : 'cold'}`,
    `restore=${metrics.restoreRequired ? 'yes' : 'no'}`
  ].join(', ');
}

export function planSummary(plan: SmartBuildPlan): string {
  const counts = { build: 0, copy: 0, fallback: 0, current: 0 };
  for (const item of plan.projects) {
    if (item.decision === 'up-to-date') counts.current += 1;
    else counts[item.decision] += 1;
  }
  return `${counts.build} build, ${counts.copy} copy, ${counts.fallback} fallback, ${counts.current} up-to-date`;
}

export function formatMs(value: number): string {
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(2)} s`;
}
