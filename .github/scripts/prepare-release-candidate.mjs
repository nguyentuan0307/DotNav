import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const options = parseArgs(process.argv.slice(2));
const base = options.base ?? 'origin/release';
const head = options.head ?? 'HEAD';
const repoUrl = options.repoUrl ?? process.env.GITHUB_REPOSITORY ?? 'nguyentuan0307/DotNav';
const config = JSON.parse(readFileSync('release-please-config.json', 'utf8'));
const manifestPath = '.release-please-manifest.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const releases = [];

for (const [packagePath, packageConfig] of Object.entries(config.packages ?? {})) {
  const commits = releasableCommits(base, head, packagePath);
  if (!commits.length) continue;

  const currentVersion = manifest[packagePath] ?? JSON.parse(readFileSync(`${packagePath}/package.json`, 'utf8')).version;
  const nextVersion = bumpVersion(currentVersion, highestBump(commits));
  const component = packageConfig.component ?? packageConfig['package-name'] ?? packagePath.split('/').pop();
  const tagName = `${component}-v${nextVersion}`;
  const previousTag = `${component}-v${currentVersion}`;
  const changelogPath = `${packagePath}/${packageConfig['changelog-path'] ?? 'CHANGELOG.md'}`;

  updatePackageJson(`${packagePath}/package.json`, nextVersion);
  updatePackageLock(packagePath, nextVersion);
  manifest[packagePath] = nextVersion;
  updateChangelog(changelogPath, {
    repoUrl,
    component,
    version: nextVersion,
    previousTag,
    tagName,
    commits
  });

  releases.push({ packagePath, component, version: nextVersion, tagName });
}

if (!releases.length) {
  console.log('No releasable commits found.');
  process.exit(0);
} else {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync('.release-candidate.json', `${JSON.stringify({ releases }, null, 2)}\n`);
  console.log(`Prepared ${releases.length} release(s): ${releases.map(item => item.tagName).join(', ')}`);
}

function releasableCommits(from, to, packagePath) {
  const output = git(['log', '--format=%H%x1f%s%x1f%b%x1e', `${from}..${to}`, '--', packagePath]);
  return output.split('\x1e')
    .map(record => record.trim())
    .filter(Boolean)
    .map(record => {
      const [hash, subject, body = ''] = record.split('\x1f');
      const parsed = parseConventionalCommit(subject, body);
      return parsed ? { hash, subject, body, ...parsed } : undefined;
    })
    .filter(Boolean)
    .reverse();
}

function parseConventionalCommit(subject, body) {
  const match = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/.exec(subject);
  if (!match) return undefined;
  const [, type, scope, bang, description] = match;
  const breaking = Boolean(bang) || /^BREAKING[ -]CHANGE:/m.test(body);
  if (breaking) return { type, scope, description, bump: 'major' };
  if (type === 'feat') return { type, scope, description, bump: 'minor' };
  if (['fix', 'perf', 'deps'].includes(type)) return { type, scope, description, bump: 'patch' };
  return undefined;
}

function highestBump(commits) {
  if (commits.some(commit => commit.bump === 'major')) return 'major';
  if (commits.some(commit => commit.bump === 'minor')) return 'minor';
  return 'patch';
}

function bumpVersion(version, bump) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function updatePackageJson(path, version) {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  json.version = version;
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
}

function updatePackageLock(packagePath, version) {
  if (!existsSync('package-lock.json')) return;
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  if (lock.packages?.[packagePath]) lock.packages[packagePath].version = version;
  writeFileSync('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);
}

function updateChangelog(path, release) {
  const original = existsSync(path) ? readFileSync(path, 'utf8') : '# Changelog\n\n';
  const beforeUnreleased = original.includes('## Unreleased')
    ? original.slice(0, original.indexOf('## Unreleased'))
    : original.replace(/\s*$/, '\n\n');
  const afterUnreleased = original.includes('## Unreleased')
    ? original.slice(original.indexOf('## Unreleased')).replace(/^## Unreleased[\s\S]*?(?=\n## \[|$)/, '')
    : '';
  const section = renderReleaseSection(release);
  writeFileSync(path, `${beforeUnreleased}## Unreleased\n\n${section}${afterUnreleased.replace(/^\n+/, '\n')}`);
}

function renderReleaseSection({ repoUrl, version, previousTag, tagName, commits }) {
  const today = new Date().toISOString().slice(0, 10);
  const groups = [
    ['major', 'Breaking Changes'],
    ['minor', 'Features'],
    ['patch-fix', 'Bug Fixes'],
    ['patch-perf', 'Performance Improvements'],
    ['patch-deps', 'Dependencies']
  ];
  const byGroup = new Map(groups.map(([key]) => [key, []]));
  for (const commit of commits) {
    const key = commit.bump === 'major' ? 'major'
      : commit.type === 'feat' ? 'minor'
        : commit.type === 'perf' ? 'patch-perf'
          : commit.type === 'deps' ? 'patch-deps'
            : 'patch-fix';
    byGroup.get(key).push(commit);
  }

  let markdown = `## [${version}](https://github.com/${repoUrl}/compare/${previousTag}...${tagName}) (${today})\n\n`;
  for (const [key, title] of groups) {
    const items = byGroup.get(key);
    if (!items?.length) continue;
    markdown += `\n### ${title}\n\n`;
    for (const commit of items) {
      const scope = commit.scope ? `**${commit.scope}:** ` : '';
      markdown += `* ${scope}${commit.description} ([${commit.hash.slice(0, 7)}](https://github.com/${repoUrl}/commit/${commit.hash}))\n`;
    }
  }
  return `${markdown}\n`;
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    parsed[args[index].replace(/^--/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = args[index + 1];
  }
  return parsed;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}
