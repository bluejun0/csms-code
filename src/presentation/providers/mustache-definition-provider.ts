import * as vscode from 'vscode';
import { ResolveMustacheDefinition } from '../../application/resolve-mustache-definition';
import { toVscodeLocationLink } from '../mappers';

export class MustacheDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private uc: ResolveMustacheDefinition) {}
  provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): vscode.LocationLink[] {
    return this.uc.run(doc.getText(), doc.offsetAt(pos)).map(toVscodeLocationLink);
  }
}
