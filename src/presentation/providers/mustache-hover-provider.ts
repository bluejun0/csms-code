import * as vscode from 'vscode';
import { DescribeMustacheSymbol } from '../../application/describe-mustache-symbol';
import { hoverWithSource } from '../source-label';

export class MustacheHoverProvider implements vscode.HoverProvider {
  constructor(private uc: DescribeMustacheSymbol) {}
  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | null {
    const r = this.uc.run(doc.getText(), doc.offsetAt(pos));
    return r ? hoverWithSource(r.markdown) : null;
  }
}
