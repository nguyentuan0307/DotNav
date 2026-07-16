import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const before = process.env.BEFORE_SHA;
const after = process.env.AFTER_SHA ?? 'HEAD';
const repoUrl = process.env.GITHUB_REPOSITORY ?? 'nguyentuan0307/DotNav';
const config = JSON.parse(readFileSync('release-please-config.json', 'utf8'));
const currentManifest = JSON.parse(readFileSync('.release-please-manifest.json', 'utf8'));
const previousManifest = before && !/^0+$/.test(before)
  ? JSON.parse(git(['show', `${before}:.release-please-manifest.json`]))
  : {};
const outputs = [];

for (const [packagePath, packageConfig] of Object.entries(config.packages ?? {})) {
  const previous = previousManifest[packagePath];
  const current = currentManifest[packagePath];
  if (!current || current === previous) continue;

  const component = packageConfig.component ?? packageConfig['package-name'] ?? packagePath.split('/').pop();
  const tagName = `${component}-v${current}`;
  const changelogPath = `${packagePath}/${packageConfig['changelog-path'] ?? 'CHANGELOG.md'}`;
  const notes = latestChangelogSection(readFileSync(changelogPath, 'utf8'), current);

  if (!tagExists(tagName)) {
    git(['tag', '-a', tagName, after, '-m', `Release ${tagName}`]);
    git(['push', 'origin', tagName]);
  }

  if (releaseExists(tagName)) {
    gh(['release', 'edit', tagName, '--title', tagName, '--notes', notes]);
  } else {
    gh(['release', 'create', tagName, '--title', tagName, '--notes', notes, '--target', after]);
  }

  outputs.push({ component, tagName });
}

const outputPath = process.env.GITHUB_OUTPUT;
for (const { component, tagName } of outputs) {
  appendOutput(`${component}_release_created`, 'true');
  appendOutput(`${component}_tag_name`, tagName);
}
for (const packageConfig of Object.values(config.packages ?? {})) {
  const component = packageConfig.component ?? packageConfig['package-name'];
  if (!outputs.some(item => item.component === component)) {
    appendOutput(`${component}_release_created`, 'false');
  }
}

function latestChangelogSection(changelog, version) {
  const marker = `## [${version}]`;
  const start = changelog.indexOf(marker);
  if (start < 0) return `Release ${version}`;
  const next = changelog.indexOf('\n## [', start + marker.length);
  return changelog.slice(start, next < 0 ? undefined : next).trim();
}

function releaseExists(tagName) {
  try {
    gh(['release', 'view', tagName, '--json', 'tagName']);
    return true;
  } catch {
    return false;
  }
}

function tagExists(tagName) {
  try {
    git(['rev-parse', '--verify', `refs/tags/${tagName}`]);
    return true;
  } catch {
    return false;
  }
}

function appendOutput(name, value) {
  if (!outputPath) return;
  appendFileSync(outputPath, `${name}=${value}\n`);
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', env: process.env }).trim();
}
