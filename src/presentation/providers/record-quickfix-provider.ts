import * as vscode from 'vscode';

export class RecordQuickFixProvider implements vscode.CodeActionProvider {
  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const d of ctx.diagnostics) {
      if (typeof d.code !== 'string' || !d.code.startsWith('csms.column.')) continue;
      const suggestion = d.code.slice('csms.column.'.length);
      const fix = new vscode.CodeAction(`'${suggestion}' 으로 변경`, vscode.CodeActionKind.QuickFix);
      fix.edit = new vscode.WorkspaceEdit();
      fix.edit.replace(doc.uri, d.range, suggestion);
      fix.diagnostics = [d];
      actions.push(fix);
    }
    return actions;
  }
}
