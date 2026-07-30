import { promises as fs } from 'fs';
import * as path from 'path';

interface Section { pattern: string; values: Map<string, string> }

export type MaxLineLengthSetting =
  | { kind: 'inherit' }
  | { kind: 'disabled' }
  | { kind: 'value'; value: number };

export type CSharpWrapStyle = 'wrap_if_long' | 'chop_if_long' | 'chop_always';

export class CSharpFormattingStyle {
  constructor(
    readonly continuationIndentMultiplier?: number,
    readonly preserveExistingLayout?: boolean,
    readonly wrapArguments?: CSharpWrapStyle,
    readonly wrapBeforeComma?: boolean
  ) {}
}

class CachedEditorConfig {
  constructor(
    readonly mtimeMs: number,
    readonly size: number,
    readonly root: boolean,
    readonly sections: Section[]
  ) {}
}

const configCache = new Map<string, CachedEditorConfig>();

export async function resolveMaxLineLength(filePath: string): Promise<MaxLineLengthSetting> {
  const values = await resolveEditorConfigValues(filePath);
  const raw = values.get('max_line_length');
  if (raw === 'off') return { kind: 'disabled' };
  if (raw === undefined || raw === 'unset') return { kind: 'inherit' };
  if (/^\d+$/.test(raw) && Number(raw) > 0) {
    return { kind: 'value', value: Number(raw) };
  }
  return { kind: 'inherit' };
}

export async function resolveCSharpFormattingStyle(filePath: string): Promise<CSharpFormattingStyle> {
  const values = await resolveEditorConfigValues(filePath);
  return new CSharpFormattingStyle(
    integerValue(values, ['dotnav_csharp_continuation_indent_multiplier'], 1, 8),
    booleanValue(values, ['dotnav_csharp_preserve_existing_layout']),
    wrapStyleValue(values, ['dotnav_csharp_wrap_arguments']),
    booleanValue(values, ['dotnav_csharp_wrap_before_comma'])
  );
}

async function resolveEditorConfigValues(filePath: string): Promise<Map<string, string>> {
  const configs: Array<{ path: string; config: CachedEditorConfig }> = [];
  let directory = path.dirname(filePath);
  while (true) {
    const candidate = path.join(directory, '.editorconfig');
    try {
      const config = await readConfig(candidate);
      configs.unshift({ path: candidate, config });
      if (config.root) break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  const result = new Map<string, string>();
  for (const entry of configs) {
    const relative = path.relative(path.dirname(entry.path), filePath).replace(/\\/g, '/');
    for (const section of entry.config.sections) {
      if (!matches(section.pattern, relative)) continue;
      for (const [key, value] of section.values) {
        if (value === 'unset') result.delete(key);
        else result.set(key, value);
      }
    }
  }
  return result;
}

function firstValue(values: ReadonlyMap<string, string>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = values.get(key);
    if (value !== undefined) return value;
  }
  return undefined;
}

function integerValue(
  values: ReadonlyMap<string, string>,
  keys: readonly string[],
  minimum: number,
  maximum: number
): number | undefined {
  const raw = firstValue(values, keys);
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return value >= minimum && value <= maximum ? value : undefined;
}

function booleanValue(values: ReadonlyMap<string, string>, keys: readonly string[]): boolean | undefined {
  const raw = firstValue(values, keys);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

function wrapStyleValue(
  values: ReadonlyMap<string, string>,
  keys: readonly string[]
): CSharpWrapStyle | undefined {
  const raw = firstValue(values, keys);
  return raw === 'wrap_if_long' || raw === 'chop_if_long' || raw === 'chop_always'
    ? raw
    : undefined;
}

async function readConfig(configPath: string): Promise<CachedEditorConfig> {
  const stat = await fs.stat(configPath);
  const cached = configCache.get(configPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached;
  }

  const content = await fs.readFile(configPath, 'utf8');
  const parsed = new CachedEditorConfig(
    stat.mtimeMs,
    stat.size,
    /^\s*root\s*=\s*true\s*$/im.test(content),
    parseSections(content)
  );
  configCache.set(configPath, parsed);
  return parsed;
}

function parseSections(content: string): Section[] {
  const sections: Section[] = [];
  let current: Section | undefined;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const header = line.match(/^\[(.+)]$/);
    if (header) { current = { pattern: header[1], values: new Map() }; sections.push(current); continue; }
    const property = line.match(/^([^=:#]+)\s*[=:]\s*(.*?)\s*$/);
    if (current && property) current.values.set(property[1].trim().toLowerCase(), property[2].toLowerCase());
  }
  return sections;
}

function matches(pattern: string, relativePath: string): boolean {
  const expanded = expandBraces(pattern);
  return expanded.some(value => {
    const target = value.includes('/') ? relativePath : path.posix.basename(relativePath);
    const regex = globRegex(value);
    return new RegExp(`^${regex}$`, 'i').test(target);
  });
}

function globRegex(pattern: string): string {
  let result = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') {
        i++;
        result += '(?:.*/)?';
      } else result += '.*';
    } else if (ch === '*') result += '[^/]*';
    else if (ch === '?') result += '[^/]';
    else result += ch.replace(/[\\^$+.()|[\]{}]/g, '\\$&');
  }
  return result;
}

function expandBraces(pattern: string): string[] {
  const match = pattern.match(/\{([^{}]+)}/);
  if (!match || match.index === undefined) return [pattern];
  return match[1].split(',').flatMap(choice => expandBraces(pattern.slice(0, match.index) + choice + pattern.slice(match.index! + match[0].length)));
}
