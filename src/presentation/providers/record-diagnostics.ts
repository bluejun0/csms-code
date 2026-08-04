import * as vscode from 'vscode';
import { ValidateRecordColumns } from '../../application/validate-record-columns';
import { KeyedDebouncer } from '../keyed-debouncer';

const CHANGE_DEBOUNCE_MS = 300;

export function registerDiagnostics(ctx: vscode.ExtensionContext, uc: ValidateRecordColumns) {
  const coll = vscode.languages.createDiagnosticCollection('csmscode');
  const debouncer = new KeyedDebouncer(CHANGE_DEBOUNCE_MS);
  ctx.subscriptions.push(debouncer, coll);
  const refresh = (doc: vscode.TextDocument) => {
    if (doc.uri.scheme !== 'file') return;
    if (doc.languageId !== 'php') return;
    if (!vscode.workspace.getConfiguration('csmscode').get('diagnostics.enable', true)) { coll.delete(doc.uri); return; }
    const items = uc.run(doc.getText());
    coll.set(doc.uri, items.map(i => {
      const range = new vscode.Range(i.line, i.column0, i.line, i.column0 + i.length);
      const d = new vscode.Diagnostic(range, i.suggestion ? `${i.message} '${i.suggestion}' 을(를) 의도하셨나요?` : i.message, vscode.DiagnosticSeverity.Warning);
      d.code = i.suggestion ? `csms.column.${i.suggestion}` : 'csms.column';
      d.source = 'CSMS Code';
      return d;
    }));
  };
  vscode.workspace.textDocuments.forEach(refresh);
  ctx.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refresh),
    // 타이핑 중 keystroke마다 재파싱하지 않도록 문서별 debounce (열림/토글은 즉시 유지)
    vscode.workspace.onDidChangeTextDocument(e => {
      // 가드 선행: 출력 채널 등 비대상 문서의 변경마다 타이머를 만들었다 지우는 churn 방지
      // (refresh 내부의 동일 가드는 다른 호출 경로 보호용으로 유지)
      if (e.document.languageId !== 'php' || e.document.uri.scheme !== 'file') return;
      debouncer.schedule(e.document.uri.toString(), () => refresh(e.document));
    }),
    vscode.workspace.onDidCloseTextDocument(d => { debouncer.cancel(d.uri.toString()); coll.delete(d.uri); }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('csmscode.diagnostics.enable')) {
        vscode.workspace.textDocuments.forEach(refresh);
      }
    }),
  );
}
