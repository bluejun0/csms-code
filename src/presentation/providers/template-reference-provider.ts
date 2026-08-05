import * as vscode from 'vscode';
import { FindTemplateReferences } from '../../application/find-template-references';
import { toVscodeLocation } from '../mappers';
import { UsageIndexHandle } from './lang-reference-provider';

/** .mustache 파일 어디서든 Shift+F12 → 그 템플릿의 render_from_template 사용처.
 *  파일 전체가 하나의 템플릿이므로 커서 위치 판정이 필요 없다. */
export class TemplateReferenceProvider implements vscode.ReferenceProvider {
  constructor(private uc: FindTemplateReferences, private usage: UsageIndexHandle,
              private refOf: (file: string) => { component: string; name: string } | null) {}

  async provideReferences(doc: vscode.TextDocument): Promise<vscode.Location[]> {
    const ref = this.refOf(doc.uri.fsPath);
    if (!ref) return [];
    if (!this.usage.built()) {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'CSMS Code: 사용처 색인 중…' },
        async progress => {
          let last = 0;
          await this.usage.build((done, total) => {
            const pct = total ? Math.floor((done / total) * 100) : 100;
            progress.report({ increment: pct - last, message: `${done}/${total} 파일` });
            last = pct;
          });
        });
    }
    return this.uc.run(ref.component, ref.name).map(toVscodeLocation);
  }
}
