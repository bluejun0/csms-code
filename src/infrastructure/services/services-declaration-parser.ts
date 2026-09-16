export interface ServiceDeclaration {
  name: string; classname: string; methodname: string; description: string; type: string; line: number;
}

const FUNCTIONS_OPENER = /\$functions\s*=\s*(?:array\s*\(|\[)/;

/** `db/services.php`의 `$functions` 항목 추출. PHP를 실행하지 않는다.
 *  값이 상수·함수 호출이거나 필드가 빠진 선언도 이름만은 잃지 않게 빈 문자열로 채운다 —
 *  목록에서 빠지면 그 API가 없는 것처럼 보인다. */
export function parseServiceDeclarations(text: string): ServiceDeclaration[] {
  const src = blankComments(text);
  const m = FUNCTIONS_OPENER.exec(src);
  return m ? collect(src, m.index + m[0].length - 1) : [];
}

/** 배열 깊이로 함수와 필드를 가른다 — 깊이 2를 여는 키가 함수 이름이고, 그 안의 문자열 쌍이 필드다.
 *  `'capabilities' => [...]` 같은 중첩은 깊이 3이라 함수로 올라오지 않는다. */
function collect(src: string, opener: number): ServiceDeclaration[] {
  const out: ServiceDeclaration[] = [];
  let depth = 0;
  let line = countNewlines(src, 0, opener);
  let key: { value: string; line: number } | null = null;
  let arrow = false;
  let current: ServiceDeclaration | null = null;

  for (let i = opener; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\n') { line++; continue; }

    if (ch === "'" || ch === '"') {
      const lit = readLiteral(src, i);
      if (arrow && key && depth === 2 && current) { assign(current, key.value, lit.value); key = null; }
      else key = { value: lit.value, line };
      arrow = false;
      line += countNewlines(src, i, lit.end);
      i = lit.end - 1;
      continue;
    }

    if (ch === '=' && src[i + 1] === '>') { arrow = key !== null; i++; continue; }

    if (ch === '[' || ch === '(') {
      depth++;
      if (depth === 2 && arrow && key) {
        current = { name: key.value, classname: '', methodname: '', description: '', type: '', line: key.line };
        out.push(current);
      }
      key = null; arrow = false;
      continue;
    }

    if (ch === ']' || ch === ')') {
      depth--;
      key = null; arrow = false;
      if (depth < 2) current = null;
      if (depth === 0) break;
    }
  }
  return out;
}

function assign(fn: ServiceDeclaration, field: string, value: string): void {
  if (field === 'classname') fn.classname = value;
  else if (field === 'methodname') fn.methodname = value;
  else if (field === 'description') fn.description = value;
  else if (field === 'type') fn.type = value;
}

/** PHP 인용부호 규칙 — 델리미터와 역슬래시만 이스케이프다.
 *  `'local_coursemos\external\User'`의 `\e`를 escape로 읽으면 클래스명이 뭉개진다. */
function readLiteral(src: string, at: number): { value: string; end: number } {
  const quote = src[at];
  let value = '';
  let i = at + 1;
  while (i < src.length && src[i] !== quote) {
    const next = src[i + 1] ?? '';
    if (src[i] === '\\' && (next === quote || next === '\\')) { value += next; i += 2; continue; }
    value += src[i]; i++;
  }
  return { value, end: Math.min(i + 1, src.length) };
}

function countNewlines(src: string, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

/** 줄 수와 오프셋을 보존하며 주석 내용만 지운다 — 선언 줄 번호가 밀리면 안 된다. */
function blankComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*(?:\/\/|#).*$/gm, m => m.replace(/[^\n]/g, ' '));
}
