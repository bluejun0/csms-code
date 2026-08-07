import * as vscode from 'vscode';
import { hoverWithSource } from '../source-label';
import { DescribeJsSymbol } from '../../application/describe-js-symbol';

export class JsHoverProvider implements vscode.HoverProvider {
  constructor(private uc: DescribeJsSymbol) {}
  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | null {
    const r = this.uc.run(doc.getText(), doc.offsetAt(pos));
    return r ? hoverWithSource(r.markdown) : null;
  }
}
