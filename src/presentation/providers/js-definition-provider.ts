import * as vscode from 'vscode';
import { ResolveJsDefinition } from '../../application/resolve-js-definition';
import { toVscodeLocationLink } from '../mappers';

export class JsDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private uc: ResolveJsDefinition) {}
  provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): vscode.LocationLink[] {
    return this.uc.run(doc.getText(), doc.offsetAt(pos)).map(toVscodeLocationLink);
  }
}
