import * as vscode from 'vscode';
import { moveItemToDirectory } from './fileCommands';
import { TreeNode } from './models';
import type { DotnetTreeProvider } from './treeProvider';

const treeMime = 'application/vnd.code.tree.dotnav';

export class ExplorerInteractionController implements vscode.TreeDragAndDropController<TreeNode> {
  readonly dragMimeTypes = [treeMime];
  readonly dropMimeTypes = [treeMime];

  private selectedNodes: readonly TreeNode[] = [];

  constructor(private readonly provider: DotnetTreeProvider) {
  }

  setSelection(selection: readonly TreeNode[]): void {
    this.selectedNodes = selection;
  }

  getSelection(): readonly TreeNode[] {
    return this.selectedNodes;
  }

  async handleDrag(source: readonly TreeNode[], dataTransfer: vscode.DataTransfer): Promise<void> {
    const draggable = source.filter(isMovableNode);
    if (draggable.length === 0) {
      return;
    }

    dataTransfer.set(treeMime, new vscode.DataTransferItem(draggable));
  }

  async handleDrop(target: TreeNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const targetDirectory = targetDirectoryFor(target);
    if (!targetDirectory) {
      return;
    }

    const transferItem = dataTransfer.get(treeMime);
    const sourceNodes = transferItem?.value as TreeNode[] | undefined;
    if (!sourceNodes || sourceNodes.length === 0) {
      return;
    }

    for (const sourceNode of sourceNodes.filter(isMovableNode)) {
      await moveItemToDirectory(this.provider, sourceNode, targetDirectory);
    }
  }
}

export function isMovableNode(node: TreeNode | undefined): node is TreeNode {
  return Boolean(node?.resourcePath && (node.kind === 'file' || node.kind === 'folder'));
}

function targetDirectoryFor(node: TreeNode | undefined): string | undefined {
  if (!node) {
    return undefined;
  }

  if (node.kind === 'folder' && node.resourcePath) {
    return node.resourcePath;
  }

  if (node.kind === 'project' && node.project) {
    return node.project.directory;
  }

  return undefined;
}
