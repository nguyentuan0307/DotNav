import * as vscode from 'vscode';
import { normalizePath } from '../pathUtils';

/**
 * Remembers per-workspace EF choices (design §3.3): which startup project
 * pairs with a migrations project and which DbContext was last used. Keys are
 * normalized absolute paths so multi-root workspaces with duplicate project
 * names cannot collide (design §7.10).
 */
export class EfConfigStore {
  constructor(private readonly state: vscode.Memento) {}

  getStartupProject(migrationsProjectPath: string): string | undefined {
    return this.state.get<string>(this.startupKey(migrationsProjectPath));
  }

  async setStartupProject(migrationsProjectPath: string, startupProjectPath: string): Promise<void> {
    await this.state.update(this.startupKey(migrationsProjectPath), normalizePath(startupProjectPath));
  }

  getLastContext(projectPath: string): string | undefined {
    return this.state.get<string>(this.contextKey(projectPath));
  }

  async setLastContext(projectPath: string, contextName: string): Promise<void> {
    await this.state.update(this.contextKey(projectPath), contextName);
  }

  private startupKey(projectPath: string): string {
    return `dotnav.ef.startupProject:${normalizePath(projectPath)}`;
  }

  private contextKey(projectPath: string): string {
    return `dotnav.ef.context:${normalizePath(projectPath)}`;
  }
}
