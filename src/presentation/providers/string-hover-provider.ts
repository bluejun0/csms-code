import * as vscode from 'vscode';
import { DescribeString } from '../../application/describe-string';
import { ReferenceCounters, hoverWithReferences } from '../references-hover';

export class StringHoverProvider implements vscode.HoverProvider {
  constructor(private uc: DescribeString, private counters: ReferenceCounters) {}
  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | null {
    const r = this.uc.run(doc.getText(), doc.offsetAt(pos));
    return r ? hoverWithReferences(doc, pos, r, this.counters) : null;
  }
}
