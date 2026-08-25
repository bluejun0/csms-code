import * as vscode from 'vscode';
import { DescribeString } from '../../application/describe-string';
import { ReferenceCounter, stringHover } from '../string-hover';

export class StringHoverProvider implements vscode.HoverProvider {
  constructor(private uc: DescribeString, private refs: ReferenceCounter) {}
  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | null {
    const r = this.uc.run(doc.getText(), doc.offsetAt(pos));
    return r ? stringHover(doc, pos, r, this.refs) : null;
  }
}
