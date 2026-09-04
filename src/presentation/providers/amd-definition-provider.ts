import * as vscode from 'vscode';
import { ResolveAmdDefinition } from '../../application/resolve-amd-definition';
import { toVscodeLocationLink } from '../mappers';

export class AmdDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private uc: ResolveAmdDefinition) {}
  provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): vscode.LocationLink[] {
    return this.uc.run(doc.getText(), doc.offsetAt(pos)).map(toVscodeLocationLink);
  }
}
