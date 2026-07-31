import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bumpVersion,
  changedReleases,
  highestBump,
  parseConventionalCommit
} from './release-utils.mjs';

const config = {
  packages: {
    'extensions/dotnav': { component: 'dotnav' },
    'extensions/gitnav': { component: 'gitnav' }
  }
};

describe('changedReleases', () => {
  it('detects only DotNav when its version changes', () => {
    const releases = changedReleases(
      config,
      { 'extensions/dotnav': '0.9.0', 'extensions/gitnav': '0.11.1' },
      { 'extensions/dotnav': '0.10.0', 'extensions/gitnav': '0.11.1' }
    );

    assert.deepEqual(releases, [{
      packagePath: 'extensions/dotnav',
      component: 'dotnav',
      previousVersion: '0.9.0',
      version: '0.10.0',
      tagName: 'dotnav-v0.10.0'
    }]);
  });

  it('detects both independently changed components', () => {
    const releases = changedReleases(
      config,
      { 'extensions/dotnav': '0.9.0', 'extensions/gitnav': '0.11.1' },
      { 'extensions/dotnav': '0.9.1', 'extensions/gitnav': '0.12.0' }
    );

    assert.deepEqual(releases.map(release => release.tagName), ['dotnav-v0.9.1', 'gitnav-v0.12.0']);
  });

  it('returns no release when versions do not change', () => {
    const manifest = { 'extensions/dotnav': '0.9.0', 'extensions/gitnav': '0.11.1' };
    assert.deepEqual(changedReleases(config, manifest, manifest), []);
  });
});

describe('version bumping', () => {
  it('maps conventional commits to the correct bump', () => {
    assert.equal(parseConventionalCommit('feat(dotnav): detect style').bump, 'minor');
    assert.equal(parseConventionalCommit('fix(dotnav): preserve chain indent').bump, 'patch');
    assert.equal(parseConventionalCommit('feat(dotnav)!: replace settings').bump, 'major');
  });

  it('chooses the highest bump and calculates the next version', () => {
    const commits = [
      parseConventionalCommit('fix(dotnav): preserve chain indent'),
      parseConventionalCommit('feat(dotnav): detect style')
    ];

    assert.equal(highestBump(commits), 'minor');
    assert.equal(bumpVersion('0.9.0', highestBump(commits)), '0.10.0');
  });

  it('rejects malformed versions', () => {
    assert.throws(() => bumpVersion('0.9', 'patch'), /Invalid current version/);
  });
});
