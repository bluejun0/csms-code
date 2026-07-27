import * as vscode from 'vscode';
import { ResolveRecordDefinition } from '../../application/resolve-record-definition';
import { toVscodeLocation } from '../mappers';

export class RecordDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private uc: ResolveRecordDefinition) {}
  provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): vscode.Location | null {
    const r = this.uc.run(doc.getText(), doc.offsetAt(pos));
    return r ? toVscodeLocation(r.location) : null;
  }
}
