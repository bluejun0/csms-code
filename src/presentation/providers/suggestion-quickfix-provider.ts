import * as vscode from 'vscode';
import { suggestionFromCode } from '../diagnostic-codes';

/** 제안이 담긴 진단(컬럼 오타·문자열 키 오타)을 그 값으로 고친다. 종류는 진단 code가 담고 있어
 *  새 종류가 생겨도 여기를 고칠 필요가 없다. */
export class SuggestionQuickFixProvider implements vscode.CodeActionProvider {
  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const d of ctx.diagnostics) {
      const suggestion = suggestionFromCode(d.code);
      if (!suggestion) continue;
      const fix = new vscode.CodeAction(`'${suggestion}' 으로 변경`, vscode.CodeActionKind.QuickFix);
      fix.edit = new vscode.WorkspaceEdit();
      fix.edit.replace(doc.uri, d.range, suggestion);
      fix.diagnostics = [d];
      actions.push(fix);
    }
    return actions;
  }
}
