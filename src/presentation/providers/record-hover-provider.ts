import * as vscode from 'vscode';
import { hoverWithSource } from '../source-label';
import { DescribeRecordSymbol } from '../../application/describe-record-symbol';

export class RecordHoverProvider implements vscode.HoverProvider {
  constructor(private uc: DescribeRecordSymbol) {}
  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | null {
    const r = this.uc.run(doc.getText(), doc.offsetAt(pos));
    return r ? hoverWithSource(r.markdown) : null;
  }
}
