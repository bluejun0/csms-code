import * as vscode from 'vscode';
import { ResolveGlobalMemberDefinition } from '../../application/resolve-global-member-definition';
import { toVscodeLocation } from '../mappers';
import { LazyIndexHandle } from './global-member-completion-provider';

export class GlobalDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private uc: ResolveGlobalMemberDefinition, private ensure: LazyIndexHandle) {}
  async provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Location[]> {
    if (!this.ensure.built()) await this.ensure.build();
    return this.uc.run(doc.getText(), doc.offsetAt(pos)).map(r => toVscodeLocation(r.location));
  }
}
