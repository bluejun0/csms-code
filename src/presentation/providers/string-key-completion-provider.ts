import * as vscode from 'vscode';
import { CompleteStringKeys } from '../../application/complete-string-keys';
import { sourceLabelEnabled, withSource } from '../source-label';
import { stringKeyCompletionComponent } from '../string-call-prefix';

const CONTEXT_WINDOW = 2000;

export class StringKeyCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private uc: CompleteStringKeys) {}
  provideCompletionItems(doc: vscode.TextDocument, pos: vscode.Position): vscode.CompletionItem[] {
    // 여러 줄에 걸친 호출(키 배열 등)도 읽도록 커서 앞뒤로 창을 둔다
    const offset = doc.offsetAt(pos);
    const before = doc.getText(new vscode.Range(doc.positionAt(Math.max(0, offset - CONTEXT_WINDOW)), pos));
    const after = doc.getText(new vscode.Range(pos, doc.positionAt(offset + CONTEXT_WINDOW)));
    // component는 커서 뒤에서 읽는다 — 아직 모르면 완성 불가(키 목록을 알 수 없음)
    const component = stringKeyCompletionComponent(before, after);
    if (!component) return [];
    const labelled = sourceLabelEnabled();
    return this.uc.run(component).map(s => {
      const it = new vscode.CompletionItem(s.key, vscode.CompletionItemKind.Text);
      // 문자열 값은 문장이라 라벨 뒤에 붙이면 행을 넘겨 출처 표시를 밀어낸다 — 상세 영역에만 둔다.
      it.detail = s.ko ?? s.en ?? '';
      if (s.ko && s.en) it.documentation = new vscode.MarkdownString(`en: ${s.en}`);
      return withSource(it, labelled);
    });
  }
}
