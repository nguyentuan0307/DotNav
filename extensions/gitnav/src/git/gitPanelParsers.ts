import { GitCommitSummary, GitFileChange } from './gitPanelModels';

const recordSeparator = '\x1e';
const fieldSeparator = '\x1f';

export const logPrettyFormat = `%x1e%H%x1f%h%x1f%P%x1f%s%x1f%an%x1f%ae%x1f%at%x1f%D`;

export function parseLog(output: string): GitCommitSummary[] {
  return output.split(recordSeparator).slice(1).flatMap(record => {
    const line = record.replace(/^\r?\n/, '').split(/\r?\n/, 1)[0];
    const fields = line.split(fieldSeparator);
    if (fields.length < 8) {
      return [];
    }
    return [{
      hash: fields[0],
      shortHash: fields[1],
      parents: fields[2] ? fields[2].split(' ') : [],
      subject: fields[3],
      author: fields[4],
      authorEmail: fields[5],
      authorTimestamp: Number(fields[6]) || 0,
      refs: fields[7].split(',').map(value => value.trim()).filter(Boolean)
    }];
  });
}

export function parseNameStatusZ(output: string): GitFileChange[] {
  const fields = output.split('\0');
  const changes: GitFileChange[] = [];
  for (let index = 0; index < fields.length - 1;) {
    const status = fields[index++];
    if (!status) continue;
    const code = status[0];
    if (code === 'R' || code === 'C') {
      const oldPath = fields[index++];
      const path = fields[index++];
      changes.push({ status: code, path, oldPath, additions: 0, deletions: 0 });
    } else {
      changes.push({ status: code, path: fields[index++], additions: 0, deletions: 0, conflict: code === 'U' });
    }
  }
  return changes;
}

export function parseNumstatZ(output: string): Map<string, { additions: number; deletions: number }> {
  const stats = new Map<string, { additions: number; deletions: number }>();
  for (const entry of output.split('\0')) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(entry);
    if (match) stats.set(match[3], { additions: Number(match[1]) || 0, deletions: Number(match[2]) || 0 });
  }
  return stats;
}

export function parseWorkingTreeStatus(output: string): GitFileChange[] {
  const fields = output.split('\0');
  const files: GitFileChange[] = [];
  for (let index = 0; index < fields.length - 1; index++) {
    const entry = fields[index];
    const status = entry.slice(0, 2).trim() || '?';
    const filePath = entry.slice(3);
    const oldPath = status.includes('R') ? fields[++index] : undefined;
    files.push({
      status, path: filePath, oldPath, additions: 0, deletions: 0,
      conflict: /^(DD|AU|UD|UA|DU|AA|UU)$/.test(status)
    });
  }
  return files;
}
