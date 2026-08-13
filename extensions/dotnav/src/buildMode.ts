export type BuildBeforeRunMode = 'standard' | 'smart' | 'none';

export function resolveBuildBeforeRunMode(
  mode: BuildBeforeRunMode | undefined,
  modeExplicit: boolean,
  legacyEnabled: boolean | undefined,
  legacyExplicit: boolean
): BuildBeforeRunMode {
  if (modeExplicit && mode) return mode;
  if (legacyExplicit && legacyEnabled === false) return 'none';
  return mode ?? 'standard';
}
