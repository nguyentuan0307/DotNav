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

export function getDiagramStorageDirectory(storageRoot?: string, workspaceRoot?: string): string | undefined {
  if (storageRoot) {
    return path.join(storageRoot, 'diagrams');
  }
  const root = workspaceRoot || getWorkspaceFolderRoot();
  if (!root) return undefined;
  return path.join(root, '.dotnav', 'diagrams');
}

export async function ensureDiagramStorageDirectory(storageRoot?: string, workspaceRoot?: string): Promise<string | undefined> {
  const dir = getDiagramStorageDirectory(storageRoot, workspaceRoot);
  if (!dir) return undefined;
  try {
    await fs.promises.mkdir(dir, { recursive: true });

    // If saving in .dotnav in workspace, write .gitignore with '*' as safety net
    if (dir.includes('.dotnav')) {
      const dotNavDir = path.dirname(dir);
      const gitIgnorePath = path.join(dotNavDir, '.gitignore');
      if (!fs.existsSync(gitIgnorePath)) {
        await fs.promises.writeFile(gitIgnorePath, '*\n', 'utf8');
      }
    }
    return dir;
  } catch {
    return undefined;
  }
}

export async function listSavedDiagrams(storageRoot?: string, workspaceRoot?: string): Promise<string[]> {
  const dir = getDiagramStorageDirectory(storageRoot, workspaceRoot);
  if (!dir) return [];

  // Auto-migrate legacy .dotnav/diagrams if storageRoot is used
  if (storageRoot) {
    const legacyDir = path.join(workspaceRoot || getWorkspaceFolderRoot() || '', '.dotnav', 'diagrams');
    if (fs.existsSync(legacyDir)) {
      try {
        await fs.promises.mkdir(dir, { recursive: true });
        const legacyFiles = await fs.promises.readdir(legacyDir);
        for (const file of legacyFiles) {
          const src = path.join(legacyDir, file);
          const dest = path.join(dir, file);
          if (!fs.existsSync(dest)) {
            await fs.promises.copyFile(src, dest);
          }
        }
      } catch {
        // ignore migration error
      }
    }
  }

  if (!fs.existsSync(dir)) return [];
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
  positions: Record<string, any>,
  storageRoot?: string,
  workspaceRoot?: string
): Promise<boolean> {
  const dir = await ensureDiagramStorageDirectory(storageRoot, workspaceRoot);
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
  storageRoot?: string,
  workspaceRoot?: string
): Promise<DiagramFile | undefined> {
  const dir = getDiagramStorageDirectory(storageRoot, workspaceRoot);
  if (!dir) return undefined;

  const cleanName = diagramName.trim().replace(/[^a-zA-Z0-9_\-\. ]/g, '_');
  const filePath = path.join(dir, `${cleanName}.diagram.json`);
  const altPath = path.join(dir, `${cleanName}.json`);

  let targetPath = fs.existsSync(filePath) ? filePath : fs.existsSync(altPath) ? altPath : undefined;

  // Fallback to legacy path if not found in storageRoot
  if (!targetPath && storageRoot) {
    const legacyDir = path.join(workspaceRoot || getWorkspaceFolderRoot() || '', '.dotnav', 'diagrams');
    const legacyPath = path.join(legacyDir, `${cleanName}.diagram.json`);
    const legacyAlt = path.join(legacyDir, `${cleanName}.json`);
    targetPath = fs.existsSync(legacyPath) ? legacyPath : fs.existsSync(legacyAlt) ? legacyAlt : undefined;
  }

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
): Record<string, any> {
  if (!savedFile || !savedFile.entities) {
    return {};
  }

  const validEntityNames = new Set(currentEntities.map(e => e.name.toLowerCase()));
  const syncedPositions: Record<string, any> = {};

  for (const [name, pos] of Object.entries(savedFile.entities)) {
    if (validEntityNames.has(name.toLowerCase())) {
      const actual = currentEntities.find(e => e.name.toLowerCase() === name.toLowerCase());
      if (actual) {
        syncedPositions[actual.name] = pos;
      }
    }
  }

  return syncedPositions;
}
