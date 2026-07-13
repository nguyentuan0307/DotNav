import * as fs from 'fs/promises';
import * as path from 'path';
import { LaunchProfile } from './models';

interface LaunchSettingsFile {
  readonly profiles?: Record<string, Partial<LaunchProfile>>;
}

export async function loadLaunchProfiles(projectDir: string): Promise<LaunchProfile[]> {
  const launchSettingsPath = path.join(projectDir, 'Properties', 'launchSettings.json');

  try {
    const content = await fs.readFile(launchSettingsPath, 'utf8');
    const parsed = JSON.parse(content) as LaunchSettingsFile;
    const profiles = parsed.profiles ?? {};

    return Object.entries(profiles)
      .filter(([, profile]) => profile.commandName?.toLowerCase() === 'project')
      .map(([name, profile]) => ({
        name,
        commandName: profile.commandName,
        applicationUrl: profile.applicationUrl,
        environmentVariables: profile.environmentVariables,
        commandLineArgs: profile.commandLineArgs,
        launchBrowser: profile.launchBrowser
      }));
  } catch {
    return [];
  }
}
