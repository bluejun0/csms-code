import * as vscode from 'vscode';
import { ValidateRecordColumns } from '../../application/validate-record-columns';

export function registerDiagnostics(ctx: vscode.ExtensionContext, uc: ValidateRecordColumns) {
  const coll = vscode.languages.createDiagnosticCollection('csmscode');
  ctx.subscriptions.push(coll);
  const refresh = (doc: vscode.TextDocument) => {
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
    vscode.workspace.onDidChangeTextDocument(e => refresh(e.document)),
    vscode.workspace.onDidCloseTextDocument(d => coll.delete(d.uri)),
  );
}
