import * as vscode from 'vscode';
import { ListResolvedStringCalls } from '../application/list-resolved-string-calls';
import { KeyedDebouncer } from './keyed-debouncer';

const HIGHLIGHT_DEBOUNCE_MS = 300;

/** 해석되는 get_string 키를 링크 색상으로 장식 — csmscode.strings.highlightResolved(기본 true) */
export function registerStringHighlight(ctx: vscode.ExtensionContext, uc: ListResolvedStringCalls) {
  const deco = vscode.window.createTextEditorDecorationType({ color: new vscode.ThemeColor('textLink.foreground') });
  const debouncer = new KeyedDebouncer(HIGHLIGHT_DEBOUNCE_MS);
  ctx.subscriptions.push(debouncer, deco);

  const refresh = (editor: vscode.TextEditor) => {
    const doc = editor.document;
    if (doc.uri.scheme !== 'file' || doc.languageId !== 'php') return;
    if (!vscode.workspace.getConfiguration('csmscode').get('strings.highlightResolved', true)) {
      editor.setDecorations(deco, []);
      return;
    }
    const ranges = uc.run(doc.getText()).map(r => new vscode.Range(r.line, r.column0, r.line, r.column0 + r.length));
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
      if (e.affectsConfiguration('csmscode.strings.highlightResolved')) vscode.window.visibleTextEditors.forEach(refresh);
    }),
  );
}
