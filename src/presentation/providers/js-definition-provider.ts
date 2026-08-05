import * as vscode from 'vscode';
import { ResolveJsDefinition } from '../../application/resolve-js-definition';
import { toVscodeLocation } from '../mappers';

export class JsDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private uc: ResolveJsDefinition) {}
  provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): vscode.Location[] {
    return this.uc.run(doc.getText(), doc.offsetAt(pos)).map(r => toVscodeLocation(r.location));
  }
}
