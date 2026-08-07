import * as vscode from 'vscode';
import { CompleteGlobalMembers } from '../../application/complete-global-members';
import { GlobalMemberItem } from '../../application/dto';
import { withSource } from '../source-label';

/** 실코드에서 압도적으로 자주 쓰는 $DB 메서드 — 100개가 넘는 목록에서 위로 올린다. */
const PREFERRED = ['get_record', 'get_records', 'get_records_sql', 'get_record_sql', 'insert_record',
  'update_record', 'get_field_sql', 'delete_records', 'execute', 'get_field', 'set_field', 'count_records'];

const KINDS: Record<GlobalMemberItem['kind'], vscode.CompletionItemKind> = {
  method: vscode.CompletionItemKind.Method,
  property: vscode.CompletionItemKind.Property,
  field: vscode.CompletionItemKind.Field,
};

/** 색인이 지연 빌드라 첫 요청에서 한 번 만든다. */
export interface LazyIndexHandle { built(): boolean; build(): Promise<void>; }

export class GlobalMemberCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private uc: CompleteGlobalMembers, private ensure: LazyIndexHandle) {}

  async provideCompletionItems(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.CompletionItem[]> {
    const line = doc.lineAt(pos.line).text.slice(0, pos.character);
    const m = line.match(/\$(\w+)->(\w*)$/);
    if (!m) return [];
    if (!this.ensure.built()) await this.ensure.build();
    const atIndex = doc.offsetAt(new vscode.Position(pos.line, pos.character - m[0].length)) + 1;
    return this.uc.run(doc.getText(), m[1], atIndex).map(item => {
      const it = new vscode.CompletionItem(item.name, KINDS[item.kind]);
      if (item.doc) it.documentation = new vscode.MarkdownString(item.doc);
      const rank = PREFERRED.indexOf(item.name);
      it.sortText = rank >= 0 ? `0${String(rank).padStart(2, '0')}` : `1${item.name}`;
      return withSource(it, item.detail);
    });
  }
}
