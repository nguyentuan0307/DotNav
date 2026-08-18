import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GitWorktreeInfo } from '../git/gitPanelModels';
import {
  buildWorktreeTooltipMarkdown,
  formatWorktreeStatusBarText,
  resolveCurrentWorktree
} from '../git/worktreeStatusBar';

const sampleWorktrees: GitWorktreeInfo[] = [
  {
    path: '/repo/main',
    head: 'a1b2c3d4e5f6',
    branch: 'master',
    detached: false,
    bare: false,
    current: true
  },
  {
    path: '/repo/features/feature-auth',
    head: 'f6e5d4c3b2a1',
    branch: 'feature/auth-v2',
    detached: false,
    bare: false,
    locked: 'Waiting for QA',
    current: false
  },
  {
    path: '/repo/hotfixes/hotfix-login',
    head: '1234567890ab',
    branch: 'hotfix/login-bug',
    detached: false,
    bare: false,
    current: false
  }
];

test('resolveCurrentWorktree correctly identifies main worktree vs linked worktrees', () => {
  // 1. Current workspace is the main repo
  const res1 = resolveCurrentWorktree(sampleWorktrees, '/repo/main', '/repo/main');
  assert.equal(res1.isMain, true);
  assert.equal(res1.current?.branch, 'master');

  // 2. Current workspace is a linked worktree
  const res2 = resolveCurrentWorktree(sampleWorktrees, '/repo/features/feature-auth', '/repo/main');
  assert.equal(res2.isMain, false);
  assert.equal(res2.current?.branch, 'feature/auth-v2');

  // 3. Fallback when workspace does not match exact path
  const res3 = resolveCurrentWorktree(sampleWorktrees, '/some/other/path', '/repo/main');
  assert.equal(res3.current?.branch, 'master');
});

test('formatWorktreeStatusBarText formats label correctly based on context', () => {
  // 1. In main repository with 3 worktrees active
  const text1 = formatWorktreeStatusBarText(sampleWorktrees, '/repo/main', '/repo/main');
  assert.equal(text1, '$(repo) 3 Worktrees');

  // 2. In linked worktree (locked)
  const text2 = formatWorktreeStatusBarText(sampleWorktrees, '/repo/features/feature-auth', '/repo/main');
  assert.equal(text2, '$(repo-forked) Worktree: feature/auth-v2 🔒');

  // 3. In linked worktree (unlocked)
  const text3 = formatWorktreeStatusBarText(sampleWorktrees, '/repo/hotfixes/hotfix-login', '/repo/main');
  assert.equal(text3, '$(repo-forked) Worktree: hotfix/login-bug');

  // 4. Only 1 worktree in repo
  const singleWorktree: GitWorktreeInfo[] = [sampleWorktrees[0]];
  const text4 = formatWorktreeStatusBarText(singleWorktree, '/repo/main', '/repo/main');
  assert.equal(text4, '$(repo) Worktrees');

  // 5. Empty worktrees
  const text5 = formatWorktreeStatusBarText([], '/repo/main', '/repo/main');
  assert.equal(text5, '');
});

test('buildWorktreeTooltipMarkdown generates rich markdown summary', () => {
  const md = buildWorktreeTooltipMarkdown(sampleWorktrees, '/repo/main', '/repo/main');

  assert.ok(md.includes('### $(repo) Git Worktrees (3 active)'));
  assert.ok(md.includes('**Current Workspace:** `master` *(Main Repo)*'));
  assert.ok(md.includes('• `feature/auth-v2` → `/repo/features/feature-auth` 🔒 *(Locked: Waiting for QA)*'));
  assert.ok(md.includes('• `hotfix/login-bug` → `/repo/hotfixes/hotfix-login`'));
  assert.ok(md.includes('[$(gear) Manage Worktrees](command:gitnav.manageWorktrees)'));
});
