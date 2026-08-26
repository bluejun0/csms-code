import * as vscode from 'vscode';
import { DescribeJsSymbol } from '../../application/describe-js-symbol';
import { ReferenceCounters, hoverWithReferences } from '../references-hover';

export class JsHoverProvider implements vscode.HoverProvider {
  constructor(private uc: DescribeJsSymbol, private counters: ReferenceCounters) {}
  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | null {
    const r = this.uc.run(doc.getText(), doc.offsetAt(pos));
    return r ? hoverWithReferences(doc, pos, r, this.counters) : null;
  }
}
