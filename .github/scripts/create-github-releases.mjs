import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import {
  changedReleases,
  componentName,
  validateReleaseMetadata
} from './release-utils.mjs';

const before = process.env.BEFORE_SHA;
const after = process.env.AFTER_SHA ?? 'HEAD';
const repoUrl = process.env.GITHUB_REPOSITORY ?? 'nguyentuan0307/DotNav';
const config = JSON.parse(readFileSync('release-please-config.json', 'utf8'));
const currentManifest = JSON.parse(readFileSync('.release-please-manifest.json', 'utf8'));
const previousManifest = readPreviousManifest(before, after);
const outputs = [];

for (const release of changedReleases(config, previousManifest, currentManifest)) {
  validateReleaseMetadata(release);
  const { packagePath, component, version, tagName } = release;
  const packageConfig = config.packages[packagePath];
  const changelogPath = `${packagePath}/${packageConfig['changelog-path'] ?? 'CHANGELOG.md'}`;
  const notes = latestChangelogSection(readFileSync(changelogPath, 'utf8'), version);

  if (!tagExists(tagName)) {
    git(['tag', '-a', tagName, after, '-m', `Release ${tagName}`]);
    git(['push', 'origin', tagName]);
  } else if (tagCommit(tagName) !== git(['rev-parse', `${after}^{commit}`])) {
    throw new Error(`Tag ${tagName} already exists on a different commit.`);
  }

  if (releaseExists(tagName)) {
    gh(['release', 'edit', tagName, '--title', tagName, '--notes', notes]);
  } else {
    gh(['release', 'create', tagName, '--title', tagName, '--notes', notes, '--target', after]);
  }

  outputs.push({ component, version, tagName });
}

const outputPath = process.env.GITHUB_OUTPUT;
for (const { component, version, tagName } of outputs) {
  appendOutput(`${component}_release_created`, 'true');
  appendOutput(`${component}_version`, version);
  appendOutput(`${component}_tag_name`, tagName);
}
for (const [packagePath, packageConfig] of Object.entries(config.packages ?? {})) {
  const component = componentName(packagePath, packageConfig);
  if (!outputs.some(item => item.component === component)) {
    appendOutput(`${component}_release_created`, 'false');
    appendOutput(`${component}_version`, '');
    appendOutput(`${component}_tag_name`, '');
  }
}

function readPreviousManifest(eventBefore, eventAfter) {
  const candidates = [];
  if (eventBefore && !/^0+$/.test(eventBefore)) candidates.push(eventBefore);
  candidates.push(`${eventAfter}^`);

  for (const candidate of candidates) {
    try {
      return JSON.parse(git(['show', `${candidate}:.release-please-manifest.json`]));
    } catch {
      // Try the first parent when the event's before SHA is unavailable.
    }
  }

  throw new Error('Cannot determine the previous release manifest.');
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

function tagCommit(tagName) {
  return git(['rev-parse', `${tagName}^{commit}`]);
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
