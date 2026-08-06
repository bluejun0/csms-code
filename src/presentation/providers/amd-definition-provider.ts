import * as vscode from 'vscode';
import { ResolveAmdDefinition } from '../../application/resolve-amd-definition';
import { toVscodeLocation } from '../mappers';

export class AmdDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private uc: ResolveAmdDefinition) {}
  provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): vscode.Location[] {
    return this.uc.run(doc.getText(), doc.offsetAt(pos)).map(r => toVscodeLocation(r.location));
  }
}
