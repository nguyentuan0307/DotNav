import { ProjectModel } from './models';

export function isRunnableProject(project: ProjectModel): boolean {
  return project.kind === 'web'
    || project.kind === 'console'
    || project.launchProfiles.length > 0;
}

export function isTestProject(project: ProjectModel): boolean {
  return project.kind === 'test';
}
