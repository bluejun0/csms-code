export interface JsStringCall { key: string; component: string; keyLine: number; keyColumn: number; keyIndex: number; }
export interface JsTemplateCall { ref: string; refLine: number; refColumn: number; refIndex: number; }
export interface JsCalls { stringCalls: JsStringCall[]; templateCalls: JsTemplateCall[]; }

// M.util.get_string / <모듈>.get_string / getString — \b가 '.' 뒤에서도 성립하므로 수신자 무관
const JS_STRING_RE = /\b(?:get_string|getString)\s*\(\s*(['"])([-\w:./]+)\1\s*,\s*(['"])(\w+)\3/g;
// Templates.render / renderForPromise / 구조분해된 render — ref에 '/'를 요구해 일반 render() 오탐을 거른다
const JS_TEMPLATE_RE = /\brender(?:ForPromise)?\s*\(\s*(['"])([-\w.]+\/[-\w./]+)\1/g;

/** JS/AMD 소스에서 리터럴 get_string·템플릿 render 호출을 추출한다.
 *  AST가 아니라 정규식이므로 주석·문자열 안의 호출도 잡힌다 — 진단이 아닌 이동/hover/참조 용도라 침묵 방향으로 안전하다. */
export function scanJsCalls(text: string): JsCalls {
  return {
    stringCalls: scan(text, JS_STRING_RE, (m, line, column, index) => ({
      key: m[2], component: m[4], keyLine: line, keyColumn: column, keyIndex: index,
    })),
    templateCalls: scan(text, JS_TEMPLATE_RE, (m, line, column, index) => ({
      ref: m[2], refLine: line, refColumn: column, refIndex: index,
    })),
  };
}

/** 공통 순회 — 라인·컬럼 모두 증분 계산(전체를 한 번만 훑는다) + 첫 따옴표 다음이 리터럴 내용 시작 */
function scan<T>(text: string, re: RegExp, make: (m: RegExpExecArray, line: number, column: number, index: number) => T): T[] {
  const out: T[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  let lastIdx = 0, lastLine = 0, lastLineStart = 0;
  while ((m = re.exec(text))) {
    for (let i = lastIdx; i < m.index; i++) {
      if (text.charCodeAt(i) === 10) { lastLine++; lastLineStart = i + 1; }
    }
    lastIdx = m.index;
    const contentIndex = m.index + m[0].search(/['"]/) + 1;
    out.push(make(m, lastLine, contentIndex - lastLineStart, contentIndex));
  }
  return out;
}
