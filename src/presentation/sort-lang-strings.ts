import * as vscode from 'vscode';
import { LangLayoutReader } from '../domain/lang-model/ports/lang-layout-reader';
import { LangSortResult, sortLangStrings } from '../domain/lang-model/services/lang-string-sorter';

export const SORT_LANG_STRINGS_COMMAND = 'csmscode.sortLangStrings';

type Unsorted = Exclude<LangSortResult, { kind: 'sorted' }>;
type UnsortableReason = Extract<Unsorted, { kind: 'unsortable' }>['reason'];

const NOTICE_OF: Record<'already-sorted' | UnsortableReason, string> = {
  'already-sorted': '이미 알파벳순으로 정렬돼 있습니다.',
  'no-strings': '정렬할 $string 항목이 없습니다.',
  'syntax-error': 'PHP 문법 오류가 있어 정렬하지 않았습니다.',
  'shared-line': '한 줄에 문장이 둘 이상인 곳이 있어 정렬하지 않았습니다.',
};

function noticeOf(result: Unsorted): string {
  return NOTICE_OF[result.kind === 'unsortable' ? result.reason : result.kind];
}

export function registerSortLangStrings(ctx: vscode.ExtensionContext, reader: LangLayoutReader,
                                        isLangFile: (fsPath: string) => boolean): void {
  ctx.subscriptions.push(vscode.commands.registerCommand(SORT_LANG_STRINGS_COMMAND, async (uri?: vscode.Uri) => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target || !isLangFile(target.fsPath)) {
      vscode.window.showInformationMessage('CSMS Code: lang 파일에서만 정렬할 수 있습니다.');
      return;
    }
    const doc = await vscode.workspace.openTextDocument(target);
    const text = doc.getText();
    const layout = reader.langLayout(text);
    const result: LangSortResult = layout ? sortLangStrings(text, layout) : { kind: 'unsortable', reason: 'syntax-error' };
    if (result.kind !== 'sorted') {
      vscode.window.showInformationMessage(`CSMS Code: ${noticeOf(result)}`);
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(target, new vscode.Range(doc.positionAt(result.start), doc.positionAt(result.end)), result.replacement);
    if (await vscode.workspace.applyEdit(edit)) await doc.save();
  }));
}

export class SortLangStringsCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;

  constructor(private firstStringLine: (doc: vscode.TextDocument) => number | null, private enabled: () => boolean) {}

  refresh(): void { this.changed.fire(); }
  dispose(): void { this.changed.dispose(); }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.enabled()) return [];
    const line = this.firstStringLine(doc);
    if (line === null) return [];
    return [new vscode.CodeLens(new vscode.Range(line, 0, line, 0),
      { title: '알파벳순 정렬', command: SORT_LANG_STRINGS_COMMAND, arguments: [doc.uri] })];
  }
}
