import * as vscode from 'vscode';
import { completionLabelParts, hoverMarkdownWithSource, SOURCE_LABEL } from './source-label-text';

export { SOURCE_LABEL };

export function sourceLabelEnabled(): boolean {
  return vscode.workspace.getConfiguration('csmscode').get<boolean>('showSourceLabel', true);
}

/** 완성 항목에 출처를 붙인다. `enabled`는 호출자가 한 번 읽어 넘긴다 —
 *  항목마다 설정을 읽으면 키 입력 한 번에 수백 번 조회한다.
 *  `labelDetail`은 라벨 바로 뒤에 공백 없이 붙으므로 타입·시그니처처럼 짧은 것만 넣는다. */
export function withSource(item: vscode.CompletionItem, enabled: boolean, labelDetail?: string): vscode.CompletionItem {
  const label = typeof item.label === 'string' ? item.label : item.label.label;
  item.label = completionLabelParts(label, labelDetail, enabled);
  return item;
}

export function hoverWithSource(markdown: string): vscode.Hover {
  return new vscode.Hover(new vscode.MarkdownString(hoverMarkdownWithSource(markdown, sourceLabelEnabled())));
}
