import * as vscode from 'vscode';
import { FindStringReferences } from '../../application/find-string-references';
import { StringTarget } from '../../application/dto';
import { toVscodeLocation } from '../mappers';
import { UsageIndexHandle, ensureUsageIndex } from './usage-index-handle';

/** 코드 쪽(PHP·JS·mustache) 문자열 호출 위에서 Shift+F12 → 그 문자열의 사용처(+lang 정의).
 *  F12가 되는 자리에서는 Shift+F12도 되어야 한다. 표면마다 위치→대상 조회만 다르고 나머지는 같다. */
export class StringReferenceProvider implements vscode.ReferenceProvider {
  constructor(private locate: (text: string, atIndex: number) => StringTarget | null,
              private uc: FindStringReferences, private usage: UsageIndexHandle) {}

  async provideReferences(doc: vscode.TextDocument, pos: vscode.Position, ctx: vscode.ReferenceContext): Promise<vscode.Location[]> {
    const target = this.locate(doc.getText(), doc.offsetAt(pos));
    if (!target) return [];
    await ensureUsageIndex(this.usage);
    return this.uc.run(target.component, target.key, ctx.includeDeclaration).map(toVscodeLocation);
  }
}
