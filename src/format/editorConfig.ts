import { promises as fs } from 'fs';
import * as path from 'path';

interface Section { pattern: string; values: Map<string, string> }

export async function resolveMaxLineLength(filePath: string): Promise<number | undefined> {
  const configs: string[] = [];
  let directory = path.dirname(filePath);
  while (true) {
    const candidate = path.join(directory, '.editorconfig');
    try {
      const content = await fs.readFile(candidate, 'utf8');
      configs.unshift(candidate);
      if (/^\s*root\s*=\s*true\s*$/im.test(content)) break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  let result: number | undefined;
  for (const config of configs) {
    const content = await fs.readFile(config, 'utf8');
    const relative = path.relative(path.dirname(config), filePath).replace(/\\/g, '/');
    for (const section of parseSections(content)) {
      if (!matches(section.pattern, relative)) continue;
      const raw = section.values.get('max_line_length');
      if (raw === 'off' || raw === 'unset') result = undefined;
      else if (raw && /^\d+$/.test(raw) && Number(raw) > 0) result = Number(raw);
    }
  }
  return result;
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
