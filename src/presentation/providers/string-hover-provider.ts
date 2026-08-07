import * as vscode from 'vscode';
import { hoverWithSource } from '../source-label';
import { DescribeString } from '../../application/describe-string';

export class StringHoverProvider implements vscode.HoverProvider {
  constructor(private uc: DescribeString) {}
  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | null {
    const r = this.uc.run(doc.getText(), doc.offsetAt(pos));
    return r ? hoverWithSource(r.markdown) : null;
  }
}
