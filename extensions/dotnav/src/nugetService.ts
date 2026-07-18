import * as https from 'https';

export interface NugetPackageSearchResult {
  readonly id: string;
  readonly latestVersion: string;
  readonly description: string;
  readonly totalDownloads: number;
}

export type OutdatedPackages = Map<string, Map<string, string>>;

interface CacheEntry<T> {
  readonly expiresAt: number;
  readonly value: T;
}

const requestTimeoutMs = 10_000;
const cacheDurationMs = 60_000;
const searchCache = new Map<string, CacheEntry<NugetPackageSearchResult[]>>();
const versionsCache = new Map<string, CacheEntry<string[]>>();

export async function searchPackages(
  query: string,
  includePrerelease: boolean,
  reportError: (message: string) => void = () => undefined
): Promise<NugetPackageSearchResult[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }

  const cacheKey = `${trimmedQuery.toLowerCase()}:${includePrerelease}`;
  const cached = getCached(searchCache, cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const url = new URL('https://azuresearch-usnc.nuget.org/query');
    url.searchParams.set('q', trimmedQuery);
    url.searchParams.set('take', '20');
    url.searchParams.set('prerelease', String(includePrerelease));
    const packages = parseSearchResponse(await getJson(url));
    searchCache.set(cacheKey, { expiresAt: Date.now() + cacheDurationMs, value: packages });
    return packages;
  } catch (error) {
    reportError(`Could not search nuget.org: ${errorMessage(error)}`);
    return [];
  }
}

export async function listVersions(
  id: string,
  includePrerelease: boolean,
  reportError: (message: string) => void = () => undefined
): Promise<string[]> {
  const cacheKey = `${id.toLowerCase()}:${includePrerelease}`;
  const cached = getCached(versionsCache, cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const encodedId = encodeURIComponent(id.toLowerCase());
    const versions = parseVersionsResponse(
      await getJson(new URL(`https://api.nuget.org/v3-flatcontainer/${encodedId}/index.json`)),
      includePrerelease
    );
    versionsCache.set(cacheKey, { expiresAt: Date.now() + cacheDurationMs, value: versions });
    return versions;
  } catch (error) {
    reportError(`Could not load versions for ${id}: ${errorMessage(error)}`);
    return [];
  }
}

export function parseSearchResponse(value: unknown): NugetPackageSearchResult[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    return [];
  }

  return value.data.flatMap(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.version !== 'string') {
      return [];
    }

    return [{
      id: item.id,
      latestVersion: item.version,
      description: typeof item.description === 'string' ? item.description : '',
      totalDownloads: typeof item.totalDownloads === 'number' ? item.totalDownloads : 0
    }];
  });
}

export function parseVersionsResponse(value: unknown, includePrerelease: boolean): string[] {
  if (!isRecord(value) || !Array.isArray(value.versions)) {
    return [];
  }

  return value.versions
    .filter((version): version is string => typeof version === 'string')
    .filter(version => includePrerelease || !isPrerelease(version))
    .sort(compareNugetVersionsDescending);
}

export function compareNugetVersionsDescending(left: string, right: string): number {
  return -compareNugetVersions(left, right);
}

export function isNewerNugetVersion(candidate: string, current: string | undefined): boolean {
  return !current || compareNugetVersions(candidate, current) > 0;
}

export function parseOutdated(stdout: string, defaultProjectPath?: string): OutdatedPackages {
  const result: OutdatedPackages = new Map();
  let currentProject = defaultProjectPath;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = stripAnsi(rawLine).trim();
    const projectMatch = /^Project\s+[`'"](.+?)[`'"]\s+has\b/i.exec(line);
    if (projectMatch) {
      currentProject = projectMatch[1];
      continue;
    }

    if (!line.startsWith('>')) {
      continue;
    }

    const columns = line.slice(1).trim().split(/\s+/);
    if (columns.length < 4 || /^package$/i.test(columns[0])) {
      continue;
    }

    const packageId = columns[0];
    const latestVersion = columns[columns.length - 1];
    if (!currentProject || !looksLikeVersion(latestVersion)) {
      continue;
    }

    let packages = result.get(currentProject);
    if (!packages) {
      packages = new Map();
      result.set(currentProject, packages);
    }
    packages.set(packageId, latestVersion);
  }

  return result;
}

function getJson(url: URL): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'DotNav-VSCode' }
    }, response => {
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`NuGet returned HTTP ${response.statusCode ?? 'unknown'}`));
        return;
      }

      response.setEncoding('utf8');
      let body = '';
      response.on('data', chunk => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('NuGet returned invalid JSON'));
        }
      });
    });

    request.setTimeout(requestTimeoutMs, () => {
      request.destroy(new Error(`request timed out after ${requestTimeoutMs / 1000} seconds`));
    });
    request.on('error', reject);
  });
}

function compareNugetVersions(left: string, right: string): number {
  const leftVersion = splitVersion(left);
  const rightVersion = splitVersion(right);
  const coreLength = Math.max(leftVersion.core.length, rightVersion.core.length);

  for (let index = 0; index < coreLength; index++) {
    const difference = (leftVersion.core[index] ?? 0) - (rightVersion.core[index] ?? 0);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }

  if (!leftVersion.prerelease && !rightVersion.prerelease) {
    return 0;
  }
  if (!leftVersion.prerelease) {
    return 1;
  }
  if (!rightVersion.prerelease) {
    return -1;
  }

  const leftIdentifiers = leftVersion.prerelease.split('.');
  const rightIdentifiers = rightVersion.prerelease.split('.');
  const prereleaseLength = Math.max(leftIdentifiers.length, rightIdentifiers.length);
  for (let index = 0; index < prereleaseLength; index++) {
    const leftIdentifier = leftIdentifiers[index];
    const rightIdentifier = rightIdentifiers[index];
    if (leftIdentifier === undefined) {
      return -1;
    }
    if (rightIdentifier === undefined) {
      return 1;
    }

    const difference = comparePrereleaseIdentifier(leftIdentifier, rightIdentifier);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function comparePrereleaseIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    return Number(left) - Number(right);
  }
  if (leftNumeric !== rightNumeric) {
    return leftNumeric ? -1 : 1;
  }
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

function splitVersion(version: string): { core: number[]; prerelease?: string } {
  const withoutMetadata = version.split('+', 1)[0];
  const separator = withoutMetadata.indexOf('-');
  const core = (separator >= 0 ? withoutMetadata.slice(0, separator) : withoutMetadata)
    .split('.')
    .map(part => Number.parseInt(part, 10) || 0);
  return {
    core,
    prerelease: separator >= 0 ? withoutMetadata.slice(separator + 1) : undefined
  };
}

function isPrerelease(version: string): boolean {
  return version.split('+', 1)[0].includes('-');
}

function looksLikeVersion(value: string): boolean {
  return /^\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
