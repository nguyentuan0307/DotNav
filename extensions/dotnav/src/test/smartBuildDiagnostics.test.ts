import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { metricsSummary, planSummary } from '../build/smartBuildDiagnostics';
import { SmartBuildPlan } from '../build/types';

test('Smart Build metrics report stage timings and cache state', () => {
  const summary = metricsSummary({
    evaluationMs: 25, planningMs: 10, copyMs: 2, msbuildMs: 1_250,
    stateCaptureMs: 8, totalMs: 1_300, builtProjects: 2, copiedFiles: 1,
    copyFailures: 0, stateFound: true, restoreRequired: false
  });
  assert.match(summary, /total=1\.30 s/);
  assert.match(summary, /cache=warm/);
  assert.match(summary, /restore=no/);
});

test('Smart Build plan summary counts every decision', () => {
  const decisions = ['build', 'copy', 'fallback', 'up-to-date'] as const;
  const plan = {
    createdAt: 0, graphFingerprint: 'graph', requiresRestore: false,
    projects: decisions.map((decision, index) => ({
      decision, reasons: [], copies: [], project: { id: String(index) }
    }))
  } as unknown as SmartBuildPlan;
  assert.equal(planSummary(plan), '1 build, 1 copy, 1 fallback, 1 up-to-date');
});
