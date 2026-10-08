import { DeclaredServiceImplementation, TextSpan } from '../../domain/service-model/ports/service-declaration-reader';

export interface ServiceDeclaration {
  name: string; classname: string; methodname: string; description: string; type: string; line: number;
}

interface CollectedDeclaration extends ServiceDeclaration {
  classpath: string;
  classnameAt: [number, number] | null;
  methodnameAt: [number, number] | null;
}

const FUNCTIONS_OPENER = /\$functions\s*=\s*(?:array\s*\(|\[)/;
const CLASS_CONSTANT = /^\\?([A-Za-z_][\w\\]*)\s*::\s*class\b/;

/** `db/services.php`의 `$functions` 항목 추출. PHP를 실행하지 않는다.
 *  값이 상수·함수 호출이거나 필드가 빠진 선언도 이름만은 잃지 않게 빈 문자열로 채운다 —
 *  목록에서 빠지면 그 API가 없는 것처럼 보인다. */
export function parseServiceDeclarations(text: string): ServiceDeclaration[] {
  return collectAll(text).map(({ name, classname, methodname, description, type, line }) =>
    ({ name, classname, methodname, description, type, line }));
}

/** 링크 구간은 원문 기준(따옴표 안쪽 또는 `::class` 앞까지)이다 — 이스케이프 때문에 값 길이와 다를 수 있다. */
export function parseServiceImplementations(text: string): DeclaredServiceImplementation[] {
  const lineStarts = lineStartsOf(text);
  const spanOf = (at: [number, number] | null) => at && spanAt(lineStarts, at);
  return collectAll(text).map(d => ({
    name: d.name, classname: d.classname, methodname: d.methodname, classpath: d.classpath,
    classnameSpan: spanOf(d.classnameAt), methodnameSpan: spanOf(d.methodnameAt),
  }));
}

function collectAll(text: string): CollectedDeclaration[] {
  const src = blankComments(text);
  const m = FUNCTIONS_OPENER.exec(src);
  return m ? collect(src, m.index + m[0].length - 1) : [];
}

/** 배열 깊이로 함수와 필드를 가른다 — 깊이 2를 여는 키가 함수 이름이고, 그 안의 문자열 쌍이 필드다.
 *  `'capabilities' => [...]` 같은 중첩은 깊이 3이라 함수로 올라오지 않는다. */
function collect(src: string, opener: number): CollectedDeclaration[] {
  const out: CollectedDeclaration[] = [];
  let depth = 0;
  let line = countNewlines(src, 0, opener);
  let key: { value: string; line: number } | null = null;
  let arrow = false;
  let current: CollectedDeclaration | null = null;

  for (let i = opener; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\n') { line++; continue; }

    if (ch === "'" || ch === '"') {
      const lit = readLiteral(src, i);
      if (arrow && key && depth === 2 && current) { assign(current, key.value, lit.value, [i + 1, lit.end - 1]); key = null; }
      else key = { value: lit.value, line };
      arrow = false;
      line += countNewlines(src, i, lit.end);
      i = lit.end - 1;
      continue;
    }

    if (ch === '=' && src[i + 1] === '>') { arrow = key !== null; i++; continue; }
    // `'ajax' => true,`처럼 리터럴이 아닌 값 뒤에서 다음 키를 그 값으로 오인하지 않게 쉼표에서 끊는다.
    if (ch === ',') { key = null; arrow = false; continue; }

    if (arrow && key && depth === 2 && current) {
      const constant = CLASS_CONSTANT.exec(src.slice(i, i + 300));
      if (constant) {
        const lead = constant[0].startsWith('\\') ? 1 : 0;
        assign(current, key.value, constant[1], [i + lead, i + lead + constant[1].length]);
        key = null; arrow = false;
        i += constant[0].length - 1;
        continue;
      }
    }

    if (ch === '[' || ch === '(') {
      depth++;
      if (depth === 2 && arrow && key) {
        current = {
          name: key.value, classname: '', methodname: '', description: '', type: '', line: key.line,
          classpath: '', classnameAt: null, methodnameAt: null,
        };
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

function assign(fn: CollectedDeclaration, field: string, value: string, at: [number, number]): void {
  if (field === 'classname') { fn.classname = value; fn.classnameAt = at; }
  else if (field === 'methodname') { fn.methodname = value; fn.methodnameAt = at; }
  else if (field === 'classpath') fn.classpath = value;
  else if (field === 'description') fn.description = value;
  else if (field === 'type') fn.type = value;
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function spanAt(lineStarts: number[], [start, end]: [number, number]): TextSpan {
  let line = 0;
  while (line + 1 < lineStarts.length && lineStarts[line + 1] <= start) line++;
  return { line, column0: start - lineStarts[line], length: end - start };
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
