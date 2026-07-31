import { readFileSync } from 'node:fs';

export function changedReleases(config, previousManifest, currentManifest) {
  const releases = [];

  for (const [packagePath, packageConfig] of Object.entries(config.packages ?? {})) {
    const previousVersion = previousManifest?.[packagePath];
    const version = currentManifest?.[packagePath];
    if (!version || version === previousVersion) continue;

    releases.push({
      packagePath,
      component: componentName(packagePath, packageConfig),
      previousVersion,
      version,
      tagName: `${componentName(packagePath, packageConfig)}-v${version}`
    });
  }

  return releases;
}

export function validateReleaseMetadata(release) {
  assertVersion(release.version, `${release.packagePath} manifest`);

  const packageJson = JSON.parse(readFileSync(`${release.packagePath}/package.json`, 'utf8'));
  if (packageJson.version !== release.version) {
    throw new Error(
      `${release.packagePath} version mismatch: manifest=${release.version}, package.json=${packageJson.version}`
    );
  }
}

export function parseConventionalCommit(subject, body = '') {
  const match = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/.exec(subject);
  if (!match) return undefined;

  const [, type, scope, bang, description] = match;
  const breaking = Boolean(bang) || /^BREAKING[ -]CHANGE:/m.test(body);
  if (breaking) return { type, scope, description, bump: 'major' };
  if (type === 'feat') return { type, scope, description, bump: 'minor' };
  if (['fix', 'perf', 'deps'].includes(type)) return { type, scope, description, bump: 'patch' };
  return undefined;
}

export function highestBump(commits) {
  if (commits.some(commit => commit.bump === 'major')) return 'major';
  if (commits.some(commit => commit.bump === 'minor')) return 'minor';
  return 'patch';
}

export function bumpVersion(version, bump) {
  assertVersion(version, 'current');
  const [major, minor, patch] = version.split('.').map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function componentName(packagePath, packageConfig) {
  return packageConfig.component ?? packageConfig['package-name'] ?? packagePath.split('/').pop();
}

function assertVersion(version, source) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
    throw new Error(`Invalid ${source} version: ${version ?? '<missing>'}`);
  }
}
