import * as vscode from 'vscode';
import { ResolveTemplateDefinition } from '../../application/resolve-template-definition';
import { toVscodeLocationLink } from '../mappers';

export class TemplateDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private uc: ResolveTemplateDefinition) {}
  provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): vscode.LocationLink[] {
    return this.uc.run(doc.getText(), doc.offsetAt(pos)).map(toVscodeLocationLink);
  }
}
