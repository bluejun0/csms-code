import * as vscode from 'vscode';
import { SourceLocation } from '../domain/shared/value-objects';
import { toVscodeLocation } from './mappers';
import { UsageIndexHandle, ensureUsageIndex } from './providers/usage-index-handle';
import { ShowReferencesArgs } from './references-link';

/** CodeLens 버튼·hover 링크가 부르는 명령 — 사용처를 VS Code 내장 참조 peek으로 그 자리에서 연다.
 *  색인이 없으면 먼저 만든다(진행률). 선언은 넣지 않는다 — 라벨의 개수와 목록이 같아야 한다. */
export function registerShowReferences(ctx: vscode.ExtensionContext, command: string,
                                       find: (component: string, key: string) => SourceLocation[], usage: UsageIndexHandle): void {
  ctx.subscriptions.push(vscode.commands.registerCommand(command, async (args: ShowReferencesArgs) => {
    await ensureUsageIndex(usage);
    const locations = find(args.component, args.key).map(toVscodeLocation);
    await vscode.commands.executeCommand('editor.action.showReferences',
      vscode.Uri.parse(args.uri), new vscode.Position(args.line, args.character), locations);
  }));
}
