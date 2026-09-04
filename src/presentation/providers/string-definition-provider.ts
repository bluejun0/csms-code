import * as vscode from 'vscode';
import { ResolveStringDefinition } from '../../application/resolve-string-definition';
import { toVscodeLocationLink } from '../mappers';

export class StringDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private uc: ResolveStringDefinition) {}
  provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): vscode.LocationLink[] {
    return this.uc.run(doc.getText(), doc.offsetAt(pos)).map(toVscodeLocationLink);
  }
}
