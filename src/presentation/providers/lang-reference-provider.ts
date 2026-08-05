import * as vscode from 'vscode';
import { FindStringReferences } from '../../application/find-string-references';
import { toVscodeLocation } from '../mappers';
import { langKeyAt } from '../lang-line-key';

/** 사용처 색인의 lazy 빌드 핸들 — 컴포지션 루트가 인프라를 감싸 주입(프로바이더는 인프라를 모른다) */
export interface UsageIndexHandle {
  built(): boolean;
  build(onProgress: (done: number, total: number) => void): Promise<void>;
}

export class LangReferenceProvider implements vscode.ReferenceProvider {
  constructor(private uc: FindStringReferences, private usage: UsageIndexHandle,
              private componentOf: (file: string) => string | null) {}

  async provideReferences(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Location[]> {
    const component = this.componentOf(doc.uri.fsPath);
    if (!component) return [];
    const key = langKeyAt(doc.lineAt(pos.line).text, pos.character);
    if (!key) return [];
    if (!this.usage.built()) {
      // 첫 요청에만 워크스페이스 스캔(진행률 알림) — 이후 저장 단위 증분(extension.ts)
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'CSMS Code: get_string 사용처 색인 중…' },
        async progress => {
          let last = 0;
          await this.usage.build((done, total) => {
            const pct = total ? Math.floor((done / total) * 100) : 100;
            progress.report({ increment: pct - last, message: `${done}/${total} 파일` });
            last = pct;
          });
        });
    }
    return this.uc.run(component, key).map(toVscodeLocation);
  }
}
