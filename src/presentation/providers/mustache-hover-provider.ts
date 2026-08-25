import * as vscode from 'vscode';
import { DescribeMustacheSymbol } from '../../application/describe-mustache-symbol';
import { ReferenceCounter, stringHover } from '../string-hover';

export class MustacheHoverProvider implements vscode.HoverProvider {
  constructor(private uc: DescribeMustacheSymbol, private refs: ReferenceCounter) {}
  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | null {
    const r = this.uc.run(doc.getText(), doc.offsetAt(pos));
    return r ? stringHover(doc, pos, r, this.refs) : null;
  }
}
