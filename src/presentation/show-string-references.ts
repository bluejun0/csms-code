import * as vscode from 'vscode';
import { FindStringReferences } from '../application/find-string-references';
import { toVscodeLocation } from './mappers';
import { UsageIndexHandle, ensureUsageIndex } from './providers/usage-index-handle';
import { SHOW_STRING_REFERENCES_COMMAND, ShowStringReferencesArgs } from './string-references-link';

/** CodeLens 버튼·hover 링크가 부르는 명령 — 사용처를 VS Code 내장 참조 peek으로 그 자리에서 연다.
 *  색인이 없으면 먼저 만든다(진행률). 선언은 넣지 않는다 — 라벨의 개수와 목록이 같아야 한다. */
export function registerShowStringReferences(ctx: vscode.ExtensionContext, uc: FindStringReferences, usage: UsageIndexHandle): void {
  ctx.subscriptions.push(vscode.commands.registerCommand(SHOW_STRING_REFERENCES_COMMAND, async (args: ShowStringReferencesArgs) => {
    await ensureUsageIndex(usage);
    const locations = uc.run(args.component, args.key).map(toVscodeLocation);
    await vscode.commands.executeCommand('editor.action.showReferences',
      vscode.Uri.parse(args.uri), new vscode.Position(args.line, args.character), locations);
  }));
}
