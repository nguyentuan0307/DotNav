import * as path from 'path';

export interface BuildDiagnosticItem {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly message: string;
}

const msBuildDiagnosticRegex = /^\s*([^\r\n(]+)\((\d+),(\d+)\)\s*:\s*(error|warning)\s+([A-Za-z0-9]+)\s*:\s*([^\r\n]+)$/gm;

export function parseBuildDiagnostics(output: string): BuildDiagnosticItem[] {
  if (!output) {
    return [];
  }

  const items: BuildDiagnosticItem[] = [];
  const matches = output.matchAll(msBuildDiagnosticRegex);

  for (const match of matches) {
    const rawFile = match[1].trim();
    const line = parseInt(match[2], 10);
    const column = parseInt(match[3], 10);
    const severity = match[4].toLowerCase() === 'warning' ? 'warning' : 'error';
    const code = match[5].trim();
    const message = match[6].trim();

    if (rawFile && !isNaN(line) && !isNaN(column)) {
      items.push({
        file: rawFile,
        line,
        column,
        severity,
        code,
        message
      });
    }
  }

  return items;
}

export function formatBuildDiagnosticSummary(item: BuildDiagnosticItem): string {
  return `${path.basename(item.file)}:${item.line} - ${item.message} (${item.code})`;
}

export function firstBuildError(output: string): BuildDiagnosticItem | undefined {
  const diagnostics = parseBuildDiagnostics(output);
  return diagnostics.find(d => d.severity === 'error') ?? diagnostics[0];
}
