import * as fs from 'fs/promises';
import * as path from 'path';
import { MicrosoftSlnf } from './scopeModel';

export interface ParsedSlnf {
  readonly solutionAbsolutePath: string;
  readonly projectAbsolutePaths: string[];
}

export async function parseSlnfFile(slnfFilePath: string): Promise<ParsedSlnf> {
  const content = await fs.readFile(slnfFilePath, 'utf8');
  const parsed = JSON.parse(content) as MicrosoftSlnf;

  if (!parsed.solution?.path || !Array.isArray(parsed.solution?.projects)) {
    throw new Error(`Invalid .slnf format in ${slnfFilePath}: missing solution.path or solution.projects array.`);
  }

  const slnfDir = path.dirname(slnfFilePath);
  const solutionAbsolutePath = path.resolve(slnfDir, parsed.solution.path);
  const solutionDir = path.dirname(solutionAbsolutePath);

  const projectAbsolutePaths = parsed.solution.projects.map(relPath => {
    return path.resolve(solutionDir, relPath);
  });

  return {
    solutionAbsolutePath,
    projectAbsolutePaths
  };
}

export async function writeSlnfFile(
  slnfFilePath: string,
  solutionAbsolutePath: string,
  projectAbsolutePaths: readonly string[]
): Promise<void> {
  const slnfDir = path.dirname(slnfFilePath);
  const solutionRelPath = path.relative(slnfDir, solutionAbsolutePath).replace(/\\/g, '/');
  const solutionDir = path.dirname(solutionAbsolutePath);

  const projectRelPaths = projectAbsolutePaths.map(projPath => {
    return path.relative(solutionDir, projPath).replace(/\\/g, '/');
  });

  const model: MicrosoftSlnf = {
    solution: {
      path: solutionRelPath,
      projects: projectRelPaths
    }
  };

  await fs.mkdir(slnfDir, { recursive: true });
  await fs.writeFile(slnfFilePath, JSON.stringify(model, null, 2), 'utf8');
}
