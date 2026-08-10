import * as vscode from 'vscode';
import { RangeItem } from '../application/dto';
import { KeyedDebouncer } from './keyed-debouncer';
import { HighlightSource, sourceApplies } from './highlight-source';

export { HighlightSource, sourceApplies };

const HIGHLIGHT_DEBOUNCE_MS = 300;


/** 해석되는 참조(문자열 키·템플릿)를 링크 색상으로 장식 — 데코레이션·디바운서는 하나로 공유한다. */
export function registerResolvedHighlight(ctx: vscode.ExtensionContext, sources: HighlightSource[]): { refreshAll(): void } {
  const deco = vscode.window.createTextEditorDecorationType({ color: new vscode.ThemeColor('textLink.foreground') });
  const debouncer = new KeyedDebouncer(HIGHLIGHT_DEBOUNCE_MS);
  ctx.subscriptions.push(debouncer, deco);

  const refresh = (editor: vscode.TextEditor) => {
    const doc = editor.document;
    if (doc.uri.scheme !== 'file') return;
    const forLang = sources.filter(s => sourceApplies(s, doc.languageId, doc.uri.fsPath));
    if (!forLang.length) return;
    const cfg = vscode.workspace.getConfiguration('csmscode');
    const text = doc.getText();
    const ranges = forLang
      .filter(s => cfg.get(s.setting, true))
      .flatMap(s => s.run(text))
      .map(r => new vscode.Range(r.line, r.column0, r.line, r.column0 + r.length));
    editor.setDecorations(deco, ranges);
  };

  vscode.window.visibleTextEditors.forEach(refresh);
  ctx.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(e => { if (e) refresh(e); }),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.scheme !== 'file') return;
      // 가드 선행 — 대상이 아닌 문서의 변경마다 타이머를 만들었다 지우는 churn 방지
      if (!sources.some(s => sourceApplies(s, e.document.languageId, e.document.uri.fsPath))) return;
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
  return { refreshAll: () => vscode.window.visibleTextEditors.forEach(refresh) };
}
