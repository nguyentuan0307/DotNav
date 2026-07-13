import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RunTargetState,
  completionPhaseForTarget,
  deriveSessionPhase,
  isActivePhase,
  transitionTarget
} from '../runSessionState';

function target(phase: RunTargetState['phase']): RunTargetState {
  return {
    targetId: 'run-1:0',
    projectPath: '/repo/App.csproj',
    projectName: 'App',
    phase
  };
}

test('accepts the normal run lifecycle', () => {
  const state = target('queued');
  transitionTarget(state, 'building');
  transitionTarget(state, 'starting');
  transitionTarget(state, 'running');
  transitionTarget(state, 'succeeded');
  assert.equal(state.phase, 'succeeded');
  assert.equal(isActivePhase(state.phase), false);
});

test('accepts a successful build-only lifecycle', () => {
  const state = target('queued');
  transitionTarget(state, 'building');
  transitionTarget(state, 'succeeded');
  assert.equal(state.phase, 'succeeded');
});

test('rejects transitions out of a terminal phase', () => {
  const state = target('stopped');
  assert.throws(() => transitionTarget(state, 'running'), /Invalid run target transition/);
});

test('allows stop while queued, building, starting, or running', () => {
  for (const phase of ['queued', 'building', 'starting', 'running'] as const) {
    const state = target(phase);
    transitionTarget(state, 'stopping');
    transitionTarget(state, 'stopped');
    assert.equal(state.phase, 'stopped');
  }
});

test('derives compound progress from the most actionable phase', () => {
  assert.equal(deriveSessionPhase([target('running'), target('starting')]), 'starting');
  assert.equal(deriveSessionPhase([target('running'), target('stopping')]), 'stopping');
  assert.equal(deriveSessionPhase([target('running'), target('failed')]), 'failed');
  assert.equal(deriveSessionPhase([target('succeeded'), target('succeeded')]), 'succeeded');
  assert.equal(deriveSessionPhase([target('stopped'), target('stopped')]), 'stopped');
});

test('treats an empty compound as failed', () => {
  assert.equal(deriveSessionPhase([]), 'failed');
});

test('distinguishes a confirmed user stop from a timeout failure', () => {
  const userStopped = target('stopping');
  assert.equal(completionPhaseForTarget(userStopped, 1), 'stopped');

  const timedOut = target('stopping');
  timedOut.error = { code: 'build-timeout', message: 'Build timed out.' };
  assert.equal(completionPhaseForTarget(timedOut, 1), 'failed');
});
