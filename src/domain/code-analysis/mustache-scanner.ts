/** `.mustache` 안의 참조 — Mustache는 파서를 두지 않으므로 정규식으로 읽는다. */
export interface MustacheTemplateRef { ref: string; line: number; column: number; index: number; }
export interface MustacheStringRef {
  key: string; component: string;
  keyLine: number; keyColumn: number; keyIndex: number;
}
export interface MustacheRefs {
  templateRefs: MustacheTemplateRef[];
  stringRefs: MustacheStringRef[];
}

// partial `{{> comp/name}}`과 parent `{{< comp/name}}`. Moodle은 항상 컴포넌트를 붙여 쓴다.
const TEMPLATE_RE = /\{\{[><]\s*([\w.-]+\/[\w.\-/]+)\s*\}\}/g;
// `{{#str}}key, component{{/str}}`과 `{{#cleanstr}}`. 닫는 태그는 요구하지 않는다 —
// 여는 태그와 두 인자만으로 충분하고 여러 줄 형태도 잡힌다. 인자가 변수면 매칭되지 않는다.
const STRING_RE = /\{\{#(?:clean)?str\}\}\s*([\w:.\-/]+)\s*,\s*(\w+)/g;

export function scanMustache(text: string): MustacheRefs {
  return {
    templateRefs: matchAll(text, TEMPLATE_RE).map(h => ({
      ref: h.captured, line: h.line, column: h.column, index: h.index,
    })),
    stringRefs: matchAll(text, STRING_RE).map(h => ({
      key: h.captured, component: h.match[2],
      keyLine: h.line, keyColumn: h.column, keyIndex: h.index,
    })),
  };
}

interface Hit { captured: string; match: RegExpExecArray; line: number; column: number; index: number; }

/** 첫 캡처의 위치를 줄·컬럼과 함께 준다. 매치마다 앞을 되짚지 않고 누적한다 —
 *  되짚으면 매치 수에 대해 제곱이 된다. */
function matchAll(text: string, re: RegExp): Hit[] {
  const out: Hit[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  let scanned = 0, line = 0, lineStart = 0;
  while ((m = re.exec(text))) {
    const at = m.index + m[0].indexOf(m[1]);
    for (; scanned < at; scanned++) {
      if (text.charCodeAt(scanned) === 10) { line++; lineStart = scanned + 1; }
    }
    out.push({ captured: m[1], match: m, line, column: at - lineStart, index: at });
  }
  return out;
}
