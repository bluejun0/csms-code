export interface EventDeclaration {
  namespace: string;
  shortName: string;
  crud: string;
  /** `get_string`의 컴포넌트가 상수·변수라 읽을 수 없으면 component는 null — 이벤트 자신의 컴포넌트로 본다. */
  title: { key: string; component: string | null } | { text: string } | null;
  line: number;
  column: number;
}

const NAMESPACE = /^\s*namespace\s+([\w\\]+)\s*;/m;
const CONCRETE_CLASS = /^([ \t]*(?:final\s+)?class\s+)(\w+)\s+extends\b/m;
const CRUD = /\$this->data\[\s*['"]crud['"]\s*\]\s*=\s*['"]([crud])['"]/;
const GET_NAME = /function\s+get_name\s*\([^)]*\)[^{]*\{/;
const GET_STRING = /get_string\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*(?:['"]([^'"]*)['"]|([^),\s][^),]*)))?/;
const RETURN_LITERAL = /^\s*return\s+(['"])((?:(?!\1)[^\\]|\\.)*)\1\s*;/;

/** 이벤트 클래스 파일 하나. PHP를 실행하지 않는다 — 추상 클래스(이벤트 기반 클래스)와 아무것도 상속하지 않는 클래스
 *  (`classes/event`에 둔 observer 등)는 이벤트가 아니므로 null. `get_name()`은 리터럴 반환 또는 첫 `get_string`을 읽고,
 *  `get_string`의 컴포넌트를 생략하면 Moodle처럼 core다. */
export function parseEventDeclaration(text: string): EventDeclaration | null {
  const src = blankComments(text);
  const cls = CONCRETE_CLASS.exec(src);
  if (!cls) return null;
  const before = src.slice(0, cls.index);
  const line = before.split('\n').length - 1;
  const column = cls.index + cls[1].length - (before.lastIndexOf('\n') + 1);
  const nameAt = GET_NAME.exec(src);
  return {
    namespace: NAMESPACE.exec(src)?.[1] ?? '',
    shortName: cls[2],
    crud: CRUD.exec(src)?.[1] ?? '',
    title: nameAt ? titleIn(src.slice(nameAt.index + nameAt[0].length, nameAt.index + nameAt[0].length + 400)) : null,
    line, column,
  };
}

function titleIn(body: string): EventDeclaration['title'] {
  const literal = RETURN_LITERAL.exec(body);
  if (literal) return { text: literal[2].replace(/\\(.)/g, '$1') };
  const call = GET_STRING.exec(body);
  if (!call) return null;
  return { key: call[1], component: call[3] ? null : call[2] || 'core' };
}

/** 줄 수와 오프셋을 보존하며 주석 내용만 지운다 — 클래스 docblock의 "class" 낱말을 선언으로 읽지 않는다. */
function blankComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*(?:\/\/|#).*$/gm, m => m.replace(/[^\n]/g, ' '));
}
