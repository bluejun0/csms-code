import * as vscode from 'vscode';
import { UsageLensTarget, lensTitle } from '../references-link';

class UsageLens extends vscode.CodeLens {
  constructor(range: vscode.Range, readonly target: UsageLensTarget) { super(range); }
}

/** 문서의 대상 줄마다 "사용 N건" 버튼. 클릭하면 그 자리에서 참조 peek이 열린다.
 *  개수는 보이는 렌즈에만(resolve) 계산한다 — 키가 수천 개인 파일에서 전부 세지 않는다.
 *  색인 전에는 "사용 찾기"만 — 파일을 여는 것만으로 워크스페이스 스캔을 시작하지 않는다(클릭이 시작한다). */
export class UsageCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;

  constructor(private targetsOf: (doc: vscode.TextDocument) => UsageLensTarget[], private enabled: () => boolean) {}

  /** 색인이 만들어지거나 갱신되면 라벨(개수)이 달라진다 — 다시 그리게 한다. */
  refresh(): void { this.changed.fire(); }
  dispose(): void { this.changed.dispose(); }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.enabled()) return [];
    return this.targetsOf(doc).map(t => new UsageLens(new vscode.Range(t.line, 0, t.line, 0), t));
  }

  resolveCodeLens(lens: vscode.CodeLens): vscode.CodeLens {
    if (!(lens instanceof UsageLens)) return lens;
    lens.command = { title: lensTitle(lens.target.count()), command: lens.target.command, arguments: [lens.target.args] };
    return lens;
  }
}
