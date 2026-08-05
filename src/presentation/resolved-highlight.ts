import * as vscode from 'vscode';
import { RangeItem } from '../application/dto';
import { KeyedDebouncer } from './keyed-debouncer';

const HIGHLIGHT_DEBOUNCE_MS = 300;

/** 하이라이트 범위 공급자 — 설정 키(csmscode 하위)와 범위 계산을 함께 넘긴다. */
export interface HighlightSource { setting: string; run(text: string): RangeItem[]; }

/** 해석되는 참조(문자열 키·템플릿)를 링크 색상으로 장식 — 데코레이션·디바운서는 하나로 공유한다. */
export function registerResolvedHighlight(ctx: vscode.ExtensionContext, sources: HighlightSource[]) {
  const deco = vscode.window.createTextEditorDecorationType({ color: new vscode.ThemeColor('textLink.foreground') });
  const debouncer = new KeyedDebouncer(HIGHLIGHT_DEBOUNCE_MS);
  ctx.subscriptions.push(debouncer, deco);

  const refresh = (editor: vscode.TextEditor) => {
    const doc = editor.document;
    if (doc.uri.scheme !== 'file' || doc.languageId !== 'php') return;
    const cfg = vscode.workspace.getConfiguration('csmscode');
    const text = doc.getText();
    const ranges = sources
      .filter(s => cfg.get(s.setting, true))
      .flatMap(s => s.run(text))
      .map(r => new vscode.Range(r.line, r.column0, r.line, r.column0 + r.length));
    editor.setDecorations(deco, ranges);
  };

  vscode.window.visibleTextEditors.forEach(refresh);
  ctx.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(e => { if (e) refresh(e); }),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.languageId !== 'php' || e.document.uri.scheme !== 'file') return; // 가드 선행 — 타이머 churn 방지
      debouncer.schedule(e.document.uri.toString(), () => {
        vscode.window.visibleTextEditors.filter(ed => ed.document === e.document).forEach(refresh);
      });
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (sources.some(s => e.affectsConfiguration(`csmscode.${s.setting}`))) {
        vscode.window.visibleTextEditors.forEach(refresh);
      }
    }),
  );
}
