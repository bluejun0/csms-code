import * as vscode from 'vscode';
import { DescribeJsSymbol } from '../../application/describe-js-symbol';

export class JsHoverProvider implements vscode.HoverProvider {
  constructor(private uc: DescribeJsSymbol) {}
  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | null {
    const r = this.uc.run(doc.getText(), doc.offsetAt(pos));
    return r ? new vscode.Hover(new vscode.MarkdownString(r.markdown)) : null;
  }
}
