import * as vscode from 'vscode';
import { CompleteStringKeys } from '../../application/complete-string-keys';
import { sourceLabelEnabled, withSource } from '../source-label';
import { isStringKeyPrefix } from '../string-call-prefix';

export class StringKeyCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private uc: CompleteStringKeys) {}
  provideCompletionItems(doc: vscode.TextDocument, pos: vscode.Position): vscode.CompletionItem[] {
    const line = doc.lineAt(pos.line).text;
    const before = line.slice(0, pos.character);
    if (!isStringKeyPrefix(before)) return [];
    // component는 커서 뒤에서 추출 — 아직 입력 전이면 완성 불가(키 목록을 알 수 없음)
    const cm = line.slice(pos.character).match(/^[\w:./-]*['"]\s*,\s*['"](\w+)['"]/);
    if (!cm) return [];
    const labelled = sourceLabelEnabled();
    return this.uc.run(cm[1]).map(s => {
      const it = new vscode.CompletionItem(s.key, vscode.CompletionItemKind.Text);
      // 문자열 값은 문장이라 라벨 뒤에 붙이면 행을 넘겨 출처 표시를 밀어낸다 — 상세 영역에만 둔다.
      it.detail = s.ko ?? s.en ?? '';
      if (s.ko && s.en) it.documentation = new vscode.MarkdownString(`en: ${s.en}`);
      return withSource(it, labelled);
    });
  }
}
