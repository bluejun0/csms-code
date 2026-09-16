import * as vscode from 'vscode';
import { ListPluginTree, PluginCategory, PluginItem } from '../../application/list-plugin-tree';
import { SourceLocation } from '../../domain/shared/value-objects';

export type ExplorerNode =
  | { kind: 'component'; component: string }
  | { kind: 'category'; component: string; category: PluginCategory; title: string; count: number }
  | { kind: 'item'; item: PluginItem };

const CATEGORY_ICONS: Record<PluginCategory, string> = {
  tables: 'database', strings: 'symbol-string', api: 'plug', templates: 'file-code',
};

/** 액티비티 바의 플러그인 탐색기. 조립은 ListPluginTree가 하고 여기서는 VSCode 표현만 만든다. */
export class PluginExplorerProvider implements vscode.TreeDataProvider<ExplorerNode> {
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private tree: ListPluginTree) {}

  refresh(): void { this.changed.fire(); }
  dispose(): void { this.changed.dispose(); }

  /** 단계마다 물어본 것만 계산한다 — 컴포넌트 수백 개를 미리 펼치지 않는다. */
  getChildren(node?: ExplorerNode): ExplorerNode[] {
    if (!node) return this.tree.components().map(component => ({ kind: 'component', component }));
    if (node.kind === 'component') {
      return this.tree.categories(node.component)
        .map(c => ({ kind: 'category', component: node.component, ...c }));
    }
    if (node.kind === 'category') {
      return this.tree.items(node.component, node.category).map(item => ({ kind: 'item', item }));
    }
    return [];
  }

  getTreeItem(node: ExplorerNode): vscode.TreeItem {
    if (node.kind === 'component') return componentItem(node.component);
    if (node.kind === 'category') return categoryItem(node);
    return itemNode(node.item);
  }
}

/** 제목·개수는 getChildren이 만든 노드에 실려 온다 — 여기서 다시 세면
 *  보이는 카테고리마다 그 컴포넌트의 네 목록을 통째로 다시 만들게 된다. */
function categoryItem(node: { category: PluginCategory; title: string; count: number }): vscode.TreeItem {
  const item = new vscode.TreeItem(
    `${node.title} (${node.count})`,
    node.count > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon(CATEGORY_ICONS[node.category]);
  item.contextValue = `csmscode.${node.category}`;
  return item;
}

function componentItem(component: string): vscode.TreeItem {
  const item = new vscode.TreeItem(component, vscode.TreeItemCollapsibleState.Collapsed);
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
