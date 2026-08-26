import * as vscode from 'vscode';
import { SourceLocation } from '../../domain/shared/value-objects';
import { toVscodeLocation } from '../mappers';
import { UsageIndexHandle, ensureUsageIndex } from './usage-index-handle';

/** 대상 판정 전·후에 만들어 두어야 하는 색인. 판정에 색인이 필요한 표면(settings.php 선언 줄)만 `beforeLocate`를 쓴다 —
 *  판정이 팩트만으로 되는 표면은 대상이 있을 때만 `beforeFind`로 깨워 무관한 Shift+F12에 비용을 물리지 않는다. */
export interface ReferencePrepare { beforeLocate?: () => Promise<void>; beforeFind?: () => Promise<void>; }

/** 커서 위치를 대상(문자열 키·설정 키…)으로 확정하고 그 대상의 사용처(+선언)를 준다.
 *  F12가 되는 자리에서는 Shift+F12도 되어야 한다. 표면마다 위치→대상 조회만 다르고 나머지는 같다. */
export class TargetReferenceProvider<T> implements vscode.ReferenceProvider {
  constructor(private locate: (doc: vscode.TextDocument, pos: vscode.Position) => T | null,
              private find: (target: T, includeDeclaration: boolean) => SourceLocation[],
              private usage: UsageIndexHandle, private prepare: ReferencePrepare = {}) {}

  async provideReferences(doc: vscode.TextDocument, pos: vscode.Position, ctx: vscode.ReferenceContext): Promise<vscode.Location[]> {
    await this.prepare.beforeLocate?.();
    const target = this.locate(doc, pos);
    if (!target) return [];
    await this.prepare.beforeFind?.();
    await ensureUsageIndex(this.usage);
    return this.find(target, ctx.includeDeclaration).map(toVscodeLocation);
  }
}
