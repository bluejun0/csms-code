import * as vscode from 'vscode';
import { SourceLocation } from '../../domain/shared/value-objects';
import { toVscodeLocation } from '../mappers';
import { UsageIndexHandle, ensureUsageIndex } from './usage-index-handle';

/** 커서 위치를 대상(문자열 키·설정 키…)으로 확정하고 그 대상의 사용처(+선언)를 준다.
 *  F12가 되는 자리에서는 Shift+F12도 되어야 한다. 표면마다 위치→대상 조회만 다르고 나머지는 같다.
 *  `prepare`는 대상 판정에 필요한 색인을 먼저 만들 때 쓴다(선언 색인이 lazy인 설정 표면). */
export class TargetReferenceProvider<T> implements vscode.ReferenceProvider {
  constructor(private locate: (doc: vscode.TextDocument, pos: vscode.Position) => T | null,
              private find: (target: T, includeDeclaration: boolean) => SourceLocation[],
              private usage: UsageIndexHandle, private prepare?: () => Promise<void>) {}

  async provideReferences(doc: vscode.TextDocument, pos: vscode.Position, ctx: vscode.ReferenceContext): Promise<vscode.Location[]> {
    await this.prepare?.();
    const target = this.locate(doc, pos);
    if (!target) return [];
    await ensureUsageIndex(this.usage);
    return this.find(target, ctx.includeDeclaration).map(toVscodeLocation);
  }
}
