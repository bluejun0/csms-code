import * as vscode from 'vscode';
import { ResolveTableDefinition } from '../../application/resolve-table-definition';
import { toVscodeLocation } from '../mappers';

export class TableDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private uc: ResolveTableDefinition) {}
  provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): vscode.Location[] {
    return this.uc.run(doc.getText(), doc.offsetAt(pos)).map(r => toVscodeLocation(r.location));
  }
}
