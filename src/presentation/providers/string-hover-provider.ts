import * as vscode from 'vscode';
import { DescribeString } from '../../application/describe-string';

export class StringHoverProvider implements vscode.HoverProvider {
  constructor(private uc: DescribeString) {}
  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | null {
    const r = this.uc.run(doc.getText(), doc.offsetAt(pos));
    return r ? new vscode.Hover(new vscode.MarkdownString(r.markdown)) : null;
  }
}
