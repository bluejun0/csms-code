import { DiagnosticKind } from '../application/dto';

/** 진단 code 문자열. 종류를 코드에 담아야 문자열 진단이 컬럼 진단으로 보이지 않는다.
 *  제안이 있으면 뒤에 붙여 QuickFix가 그것만으로 고칠 값을 알 수 있게 한다. */
export function diagnosticCode(kind: DiagnosticKind, suggestion?: string): string {
  return suggestion ? `csms.${kind}.${suggestion}` : `csms.${kind}`;
}

const CODE_RE = /^csms\.(column|string)\.(.+)$/;

/** 진단 code에서 제안 값 — 종류가 늘어도 QuickFix가 함께 늘어나도록 한 곳에서 해석한다. */
export function suggestionFromCode(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const m = CODE_RE.exec(code);
  return m ? m[2] : null;
}
