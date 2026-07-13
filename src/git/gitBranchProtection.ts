export function matchingProtectedBranchPattern(branch: string, patterns: string[]): string | undefined {
  return patterns.find(pattern => new RegExp(`^${pattern.split('*').map(escapeRegex).join('.*')}$`).test(branch));
}

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
