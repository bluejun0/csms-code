import * as vscode from 'vscode';
import { DescribeGlobalMember } from '../../application/describe-global-member';
import { LazyIndexHandle } from './global-member-completion-provider';

export class GlobalHoverProvider implements vscode.HoverProvider {
  constructor(private uc: DescribeGlobalMember, private ensure: LazyIndexHandle) {}
  async provideHover(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Hover | null> {
    if (!this.ensure.built()) await this.ensure.build();
    const r = this.uc.run(doc.getText(), doc.offsetAt(pos));
    return r ? new vscode.Hover(new vscode.MarkdownString(r.markdown)) : null;
  }
}
