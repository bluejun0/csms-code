import * as vscode from 'vscode';
import { SourceLocation } from '../domain/shared/value-objects';
export function toVscodeLocation(loc: SourceLocation): vscode.Location {
  return new vscode.Location(vscode.Uri.file(loc.uri), new vscode.Position(loc.line, loc.column));
}
