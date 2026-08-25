import * as vscode from 'vscode';
import { DescribeJsSymbol } from '../../application/describe-js-symbol';
import { ReferenceCounter, stringHover } from '../string-hover';

export class JsHoverProvider implements vscode.HoverProvider {
  constructor(private uc: DescribeJsSymbol, private refs: ReferenceCounter) {}
  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | null {
    const r = this.uc.run(doc.getText(), doc.offsetAt(pos));
    return r ? stringHover(doc, pos, r, this.refs) : null;
  }
}
