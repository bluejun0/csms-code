import * as vscode from 'vscode';
import { SOURCE_LABEL } from './source-label-text';

export interface IndexCounts { tables: number; strings: number; templates: number; amd: number; }

/** 확장이 살아 있고 무엇을 색인했는지 화면 아래에 계속 보여준다 —
 *  인텔리전스가 우리 것인지 다른 확장 것인지 확인할 수 있어야 한다. */
export function registerStatusBar(ctx: vscode.ExtensionContext, root: string): {
  setIndexing(): void; setReady(counts: IndexCounts): void; setFailed(err: unknown): void;
} {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  ctx.subscriptions.push(item);
  item.text = `$(sync~spin) ${SOURCE_LABEL}`;
  item.tooltip = `${root}\n색인 중…`;
  item.show();

  return {
    setIndexing() {
      item.text = `$(sync~spin) ${SOURCE_LABEL}`;
      item.tooltip = `${root}\n색인 중…`;
    },
    setFailed(err: unknown) {
      item.text = `$(error) ${SOURCE_LABEL}`;
      item.tooltip = `${root}\n색인에 실패했습니다: ${err instanceof Error ? err.message : String(err)}`;
    },
    setReady(c: IndexCounts) {
      item.text = `$(database) ${SOURCE_LABEL} ${c.tables}`;
      item.tooltip = new vscode.MarkdownString(
        [`**${SOURCE_LABEL}** — Moodle 루트`, '', `\`${root}\``, '',
          `- 테이블 ${c.tables}`, `- 언어 문자열 ${c.strings}`,
          `- 템플릿 ${c.templates}`, `- AMD 모듈 ${c.amd}`].join('\n'));
    },
  };
}
