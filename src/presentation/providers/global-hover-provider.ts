import * as vscode from 'vscode';
import { DescribeGlobalMember } from '../../application/describe-global-member';
import { LazyIndexHandle } from './global-member-completion-provider';
import { hoverWithSource } from '../source-label';

export class GlobalHoverProvider implements vscode.HoverProvider {
  constructor(private uc: DescribeGlobalMember, private ensure: LazyIndexHandle) {}
  async provideHover(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Hover | null> {
    const text = doc.getText();
    const at = doc.offsetAt(pos);
    // 전역 멤버가 아닌 자리에서는 색인을 만들지 않는다 — hover는 모든 위치에서 호출된다.
    if (!this.uc.targets(text, at)) return null;
    if (!this.ensure.built()) await this.ensure.build();
    const r = this.uc.run(text, at);
    return r ? hoverWithSource(r.markdown) : null;
  }
}
