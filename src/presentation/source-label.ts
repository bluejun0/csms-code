import * as vscode from 'vscode';
import { completionLabelParts, hoverMarkdownWithSource, SOURCE_LABEL } from './source-label-text';

export { SOURCE_LABEL };

export function sourceLabelEnabled(): boolean {
  return vscode.workspace.getConfiguration('csmscode').get<boolean>('showSourceLabel', true);
}

/** 완성 항목에 출처를 붙인다. detail은 기존처럼 상세 영역에도 남긴다. */
export function withSource(item: vscode.CompletionItem, detail?: string): vscode.CompletionItem {
  if (detail) item.detail = detail;
  const label = typeof item.label === 'string' ? item.label : item.label.label;
  item.label = completionLabelParts(label, detail, sourceLabelEnabled());
  return item;
}

export function hoverWithSource(markdown: string): vscode.Hover {
  return new vscode.Hover(new vscode.MarkdownString(hoverMarkdownWithSource(markdown, sourceLabelEnabled())));
}
