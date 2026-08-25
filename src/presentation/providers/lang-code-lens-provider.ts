import * as vscode from 'vscode';
import { ReferenceCounter, SHOW_STRING_REFERENCES_COMMAND, ShowStringReferencesArgs, lensTitle } from '../string-references-link';

/** lang 파일에서 뽑은 항목 한 줄 — 컴포지션 루트가 파서를 감싸 주입한다. */
export interface LangEntryLine { key: string; line: number; }

class LangStringLens extends vscode.CodeLens {
  constructor(range: vscode.Range, readonly args: ShowStringReferencesArgs) { super(range); }
}

/** lang 파일의 `$string['key']` 줄마다 "사용처 N곳" 버튼. 클릭하면 그 자리에서 참조 peek이 열린다.
 *  개수는 보이는 렌즈에만(resolve) 계산한다 — moodle.php처럼 키가 수천 개인 파일에서 전부 세지 않는다.
 *  색인 전에는 "사용처 보기"만 — 파일을 여는 것만으로 워크스페이스 스캔을 시작하지 않는다(클릭이 시작한다). */
export class LangCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;

  constructor(private entriesOf: (text: string) => LangEntryLine[],
              private componentOf: (file: string) => string | null,
              private refs: ReferenceCounter, private enabled: () => boolean) {}

  /** 색인이 만들어지거나 갱신되면 라벨(개수)이 달라진다 — 다시 그리게 한다. */
  refresh(): void { this.changed.fire(); }
  dispose(): void { this.changed.dispose(); }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.enabled()) return [];
    const component = this.componentOf(doc.uri.fsPath);
    if (!component) return [];
    return this.entriesOf(doc.getText()).map(e => new LangStringLens(
      new vscode.Range(e.line, 0, e.line, 0),
      { uri: doc.uri.toString(), line: e.line, character: 0, component, key: e.key }));
  }

  resolveCodeLens(lens: vscode.CodeLens): vscode.CodeLens {
    if (!(lens instanceof LangStringLens)) return lens;
    const count = this.refs.built() ? this.refs.count(lens.args.component, lens.args.key) : null;
    lens.command = { title: lensTitle(count), command: SHOW_STRING_REFERENCES_COMMAND, arguments: [lens.args] };
    return lens;
  }
}
