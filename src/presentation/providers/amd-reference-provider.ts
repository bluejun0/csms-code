import * as vscode from 'vscode';
import { FindAmdReferences } from '../../application/find-amd-references';
import { toVscodeLocation } from '../mappers';
import { UsageIndexHandle, ensureUsageIndex } from './usage-index-handle';

/** amd/src의 .js 파일 어디서든 Shift+F12 → 그 모듈의 js_call_amd 사용처.
 *  파일 하나가 모듈 하나이므로 커서 위치 판정이 필요 없다. */
export class AmdReferenceProvider implements vscode.ReferenceProvider {
  constructor(private uc: FindAmdReferences, private usage: UsageIndexHandle,
              private refOf: (file: string) => { component: string; name: string } | null) {}

  async provideReferences(doc: vscode.TextDocument): Promise<vscode.Location[]> {
    const ref = this.refOf(doc.uri.fsPath);
    if (!ref) return [];
    await ensureUsageIndex(this.usage);
    return this.uc.run(ref.component, ref.name).map(toVscodeLocation);
  }
}
