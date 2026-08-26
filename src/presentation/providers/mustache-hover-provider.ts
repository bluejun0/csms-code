import * as vscode from 'vscode';
import { DescribeMustacheSymbol } from '../../application/describe-mustache-symbol';
import { ReferenceCounters, hoverWithReferences } from '../references-hover';

export class MustacheHoverProvider implements vscode.HoverProvider {
  constructor(private uc: DescribeMustacheSymbol, private counters: ReferenceCounters) {}
  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | null {
    const r = this.uc.run(doc.getText(), doc.offsetAt(pos));
    return r ? hoverWithReferences(doc, pos, r, this.counters) : null;
  }
}
