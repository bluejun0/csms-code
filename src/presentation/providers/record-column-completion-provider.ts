import * as vscode from 'vscode';
import { CompleteRecordColumns } from '../../application/complete-record-columns';
import { sourceLabelEnabled, withSource } from '../source-label';

export class RecordColumnCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private uc: CompleteRecordColumns) {}
  provideCompletionItems(doc: vscode.TextDocument, pos: vscode.Position): vscode.CompletionItem[] {
    const line = doc.lineAt(pos.line).text.slice(0, pos.character);
    const m = line.match(/\$(\w+)->(\w*)$/);   // $var->partial
    if (!m) return [];
    const varName = m[1];
    const atIndex = doc.offsetAt(new vscode.Position(pos.line, pos.character - m[0].length)) + 1; // '$' 다음(변수 위치)
    const cols = this.uc.run(doc.getText(), varName, atIndex);
    const labelled = sourceLabelEnabled();
    return cols.map(c => {
      const it = new vscode.CompletionItem(c.name, vscode.CompletionItemKind.Field);
      it.detail = c.type;
      if (c.comment) it.documentation = new vscode.MarkdownString(c.comment);
      return withSource(it, labelled, c.type);
    });
  }
}
