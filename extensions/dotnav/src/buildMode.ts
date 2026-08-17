export type BuildBeforeRunMode = 'standard' | 'none';

export function resolveBuildBeforeRunMode(
  mode: string | undefined,
  modeExplicit: boolean,
  legacyEnabled: boolean | undefined,
  legacyExplicit: boolean
): BuildBeforeRunMode {
  if (modeExplicit && mode) return mode === 'none' ? 'none' : 'standard';
  if (legacyExplicit && legacyEnabled === false) return 'none';
  return 'standard';
}
