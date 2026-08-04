import * as vscode from 'vscode';
import { ResolveStringDefinition } from '../../application/resolve-string-definition';
import { toVscodeLocation } from '../mappers';

export class StringDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private uc: ResolveStringDefinition) {}
  provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): vscode.Location[] {
    return this.uc.run(doc.getText(), doc.offsetAt(pos)).map(r => toVscodeLocation(r.location));
  }
}
