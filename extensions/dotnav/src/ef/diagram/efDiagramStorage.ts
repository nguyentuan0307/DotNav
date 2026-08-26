import * as fs from 'fs';
import * as path from 'path';
import { DiagramFile, EntityModel } from './efDiagramModel';

function getWorkspaceFolderRoot(): string | undefined {
  try {
    const vscode = require('vscode');
    return vscode.workspace?.workspaceFolders?.[0]?.uri?.fsPath;
  } catch {
    return process.cwd();
  }
}

export function getDiagramStorageDirectory(workspaceRoot?: string): string | undefined {
  const root = workspaceRoot || getWorkspaceFolderRoot();
  if (!root) return undefined;
  return path.join(root, '.dotnav', 'diagrams');
}

export async function ensureDiagramStorageDirectory(workspaceRoot?: string): Promise<string | undefined> {
  const dir = getDiagramStorageDirectory(workspaceRoot);
  if (!dir) return undefined;
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    return dir;
  } catch {
    return undefined;
  }
}

export async function listSavedDiagrams(workspaceRoot?: string): Promise<string[]> {
  const dir = getDiagramStorageDirectory(workspaceRoot);
  if (!dir || !fs.existsSync(dir)) return [];
  try {
    const files = await fs.promises.readdir(dir);
    return files
      .filter(f => f.endsWith('.diagram.json') || f.endsWith('.json'))
      .map(f => f.replace(/\.diagram\.json$/, '').replace(/\.json$/, ''))
      .sort();
  } catch {
    return [];
  }
}

export async function saveDiagramToFile(
  diagramName: string,
  positions: Record<string, { x: number; y: number }>,
  workspaceRoot?: string
): Promise<boolean> {
  const dir = await ensureDiagramStorageDirectory(workspaceRoot);
  if (!dir) return false;

  const cleanName = diagramName.trim().replace(/[^a-zA-Z0-9_\-\. ]/g, '_') || 'Default';
  const filePath = path.join(dir, `${cleanName}.diagram.json`);

  const fileData: DiagramFile = {
    version: 1,
    name: cleanName,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    entities: positions
  };

  try {
    await fs.promises.writeFile(filePath, JSON.stringify(fileData, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`[DotNav] Failed to save diagram: ${err}`);
    return false;
  }
}

export async function loadDiagramFromFile(
  diagramName: string,
  workspaceRoot?: string
): Promise<DiagramFile | undefined> {
  const dir = getDiagramStorageDirectory(workspaceRoot);
  if (!dir) return undefined;

  const cleanName = diagramName.trim().replace(/[^a-zA-Z0-9_\-\. ]/g, '_');
  const filePath = path.join(dir, `${cleanName}.diagram.json`);
  const altPath = path.join(dir, `${cleanName}.json`);

  const targetPath = fs.existsSync(filePath) ? filePath : fs.existsSync(altPath) ? altPath : undefined;
  if (!targetPath) return undefined;

  try {
    const raw = await fs.promises.readFile(targetPath, 'utf8');
    const parsed = JSON.parse(raw) as DiagramFile;
    return parsed;
  } catch {
    return undefined;
  }
}

export function liveSyncDiagramWithCode(
  savedFile: DiagramFile | undefined,
  currentEntities: readonly EntityModel[]
): Record<string, { x: number; y: number }> {
  if (!savedFile || !savedFile.entities) {
    return {};
  }

  const validEntityNames = new Set(currentEntities.map(e => e.name.toLowerCase()));
  const syncedPositions: Record<string, { x: number; y: number }> = {};

  for (const [name, pos] of Object.entries(savedFile.entities)) {
    if (validEntityNames.has(name.toLowerCase())) {
      // Find actual casing
      const actual = currentEntities.find(e => e.name.toLowerCase() === name.toLowerCase());
      if (actual) {
        syncedPositions[actual.name] = pos;
      }
    }
  }

  return syncedPositions;
}
