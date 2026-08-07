import * as vscode from 'vscode';
import { ResolveGlobalMemberDefinition } from '../../application/resolve-global-member-definition';
import { toVscodeLocation } from '../mappers';
import { LazyIndexHandle } from './global-member-completion-provider';

export class GlobalDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private uc: ResolveGlobalMemberDefinition, private ensure: LazyIndexHandle) {}
  async provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Location[]> {
    const text = doc.getText();
    const at = doc.offsetAt(pos);
    // 전역 멤버가 아닌 자리에서는 색인을 만들지 않는다 — 정의 이동은 모든 위치에서 호출된다.
    if (!this.uc.targets(text, at)) return [];
    if (!this.ensure.built()) await this.ensure.build();
    return this.uc.run(text, at).map(r => toVscodeLocation(r.location));
  }
}
