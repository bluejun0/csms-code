import * as vscode from 'vscode';
import { SourceLocation } from '../domain/shared/value-objects';
import { DefinitionResult } from '../application/dto';
import { definitionLinkRanges, LinkRange } from './definition-link';

export function toVscodeLocation(loc: SourceLocation): vscode.Location {
  return new vscode.Location(vscode.Uri.file(loc.uri), new vscode.Position(loc.line, loc.column));
}

const toRange = (r: LinkRange) => new vscode.Range(r.startLine, r.startColumn, r.endLine, r.endColumn);

export function toVscodeLocationLink(result: DefinitionResult): vscode.LocationLink {
  const { origin, target } = definitionLinkRanges(result);
  const at = toRange(target);
  return {
    originSelectionRange: origin && toRange(origin),
    targetUri: vscode.Uri.file(result.location.uri),
    targetRange: at,
    targetSelectionRange: at,
  };
}
