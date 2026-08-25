import * as vscode from 'vscode';
import { FindStringReferences } from '../../application/find-string-references';
import { toVscodeLocation } from '../mappers';
import { langKeyAt } from '../lang-line-key';
import { UsageIndexHandle, ensureUsageIndex } from './usage-index-handle';

/** lang 파일의 `$string['key']` 줄에서 Shift+F12 → 그 키의 사용처. */
export class LangReferenceProvider implements vscode.ReferenceProvider {
  constructor(private uc: FindStringReferences, private usage: UsageIndexHandle,
              private componentOf: (file: string) => string | null) {}

  async provideReferences(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Location[]> {
    const component = this.componentOf(doc.uri.fsPath);
    if (!component) return [];
    const key = langKeyAt(doc.lineAt(pos.line).text, pos.character);
    if (!key) return [];
    await ensureUsageIndex(this.usage);
    return this.uc.run(component, key).map(toVscodeLocation);
  }
}
