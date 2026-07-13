import * as vscode from 'vscode';
import { TreeNode } from './models';
import { DotnetTreeProvider } from './treeProvider';

export class RunConfigTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | null | void>;

  constructor(private readonly solutionProvider: DotnetTreeProvider) {
    this.onDidChangeTreeData = solutionProvider.onDidChangeTreeData;
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    return this.solutionProvider.getTreeItem(node);
  }

  async getChildren(node?: TreeNode): Promise<TreeNode[]> {
    return node ? [] : this.solutionProvider.getRunConfigNodes();
  }

  getParent(): undefined {
    return undefined;
  }
}
