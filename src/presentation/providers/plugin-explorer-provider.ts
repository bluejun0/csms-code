import * as vscode from 'vscode';
import { ListPluginTree, PluginCategory, PluginItem } from '../../application/list-plugin-tree';
import { SourceLocation } from '../../domain/shared/value-objects';

export type ExplorerNode =
  | { kind: 'component'; component: string; count: number }
  | { kind: 'item'; item: PluginItem };

/** 카테고리 뷰 하나(테이블·문자열·API·템플릿 중 하나). 조립은 ListPluginTree가 하고
 *  여기서는 VSCode 표현만 만든다. 같은 클래스를 카테고리만 바꿔 네 번 등록한다. */
export class PluginExplorerProvider implements vscode.TreeDataProvider<ExplorerNode> {
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private tree: ListPluginTree, private category: PluginCategory) {}

  refresh(): void { this.changed.fire(); }
  dispose(): void { this.changed.dispose(); }

  /** 펼친 컴포넌트의 항목만 만든다 — 뷰를 열었다고 전부 펼치지 않는다. */
  getChildren(node?: ExplorerNode): ExplorerNode[] {
    if (!node) return this.tree.componentsIn(this.category).map(c => ({ kind: 'component', ...c }));
    if (node.kind === 'component') {
      return this.tree.items(node.component, this.category).map(item => ({ kind: 'item', item }));
    }
    return [];
  }

  getTreeItem(node: ExplorerNode): vscode.TreeItem {
    return node.kind === 'component' ? componentItem(node) : itemNode(node.item);
  }
}

function componentItem(node: { component: string; count: number }): vscode.TreeItem {
  const item = new vscode.TreeItem(node.component, vscode.TreeItemCollapsibleState.Collapsed);
  item.description = `${node.count}개`;
  item.iconPath = new vscode.ThemeIcon('package');
  item.contextValue = 'csmscode.component';
  return item;
}

function itemNode(entry: PluginItem): vscode.TreeItem {
  const item = new vscode.TreeItem(entry.label, vscode.TreeItemCollapsibleState.None);
  item.description = entry.detail;
  item.tooltip = entry.detail ? `${entry.label}\n${entry.detail}` : entry.label;
  item.command = openAt(entry.location);
  item.contextValue = 'csmscode.item';
  return item;
}

function openAt(location: SourceLocation): vscode.Command {
  const at = new vscode.Position(location.line, location.column);
  return {
    command: 'vscode.open',
    title: '열기',
    arguments: [vscode.Uri.file(location.uri), { selection: new vscode.Range(at, at) }],
  };
}
