export interface EfCapabilities {
  readonly major: number;
  readonly hasPendingModelChanges: boolean;
  readonly removeOffline: boolean;
  readonly removeConnection: boolean;
  readonly dropConnection: boolean;
  readonly updateAdd: boolean;
  readonly migrationsBundle: boolean;
  readonly dbContextOptimize: boolean;
  readonly optimizeNativeAot: boolean;
}

/**
 * Capabilities are gated by the lower major of the project Design package and
 * dotnet-ef. This keeps a newer global tool from exposing switches that the
 * project's runtime cannot understand.
 */
export function capabilitiesForVersions(
  projectVersion?: string,
  toolVersion?: string
): EfCapabilities {
  const projectMajor = parseMajor(projectVersion);
  const toolMajor = parseMajor(toolVersion);
  const known = [projectMajor, toolMajor].filter((value): value is number => value !== undefined);
  const major = known.length > 0 ? Math.min(...known) : 6;

  return {
    major,
    hasPendingModelChanges: major >= 8,
    removeOffline: major >= 11,
    removeConnection: major >= 11,
    dropConnection: major >= 11,
    updateAdd: major >= 11,
    migrationsBundle: major >= 6,
    dbContextOptimize: major >= 6,
    optimizeNativeAot: major >= 9
  };
}

export function parseMajor(version?: string): number | undefined {
  if (!version) {
    return undefined;
  }

  const match = /(?:^|[^\d])(\d+)(?:\.|$)/.exec(version);
  if (!match) {
    return undefined;
  }

  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}
