export interface ParsedLangString { key: string; value: string; line: number; }

/** 리터럴이 아닌 조각(다른 `$string[…]` 참조·변수·함수 호출)을 값에 표시하는 자리표시자. */
const UNKNOWN_PART = '…';

/** Moodle lang 파일의 `$string['key'] = …;` 항목 추출.
 *  값은 홑따옴표·겹따옴표 리터럴과 `.` 연결을 모두 읽는다 — 어느 쪽이든 빠뜨리면 그 키를 쓰는
 *  곳마다 "문자열이 없습니다" 오탐이 난다. 연결 안의 비리터럴 조각은 자리표시자로 남긴다. */
export function parseLangFile(text: string): ParsedLangString[] {
  const out: ParsedLangString[] = [];
  // 키와 대입까지만 정규식으로 찾고, 값은 인용부호·연결을 아는 스캐너로 읽는다.
  // 델리미터별로 문자 클래스를 갈라 쓴다 — 하나로 두 인용부호를 함께 배제하면
  // 홑따옴표 값 안의 `"`(실측 510건)와 그 반대가 탈락한다.
  const head = /\$string\[\s*(?:'((?:[^'\\]|\\.)+)'|"((?:[^"\\]|\\.)+)")\s*\]\s*=\s*/g;
  let m: RegExpExecArray | null;
  let lastIdx = 0, lastLine = 0; // 증분 라인 계산 — 매치마다 전체 접두부를 재스캔(O(n²))하지 않는다
  while ((m = head.exec(text))) {
    for (let i = lastIdx; i < m.index; i++) if (text.charCodeAt(i) === 10) lastLine++;
    lastIdx = m.index;
    const { value, end } = readValue(text, head.lastIndex);
    if (end < 0) continue; // 종결 `;`를 찾지 못하면 이 항목은 버린다
    out.push({ key: unescape(m[1] ?? m[2]), value, line: lastLine });
    // 값 안의 `$string['other']` 참조를 새 항목으로 오인하지 않도록 값 끝까지 건너뛴다.
    head.lastIndex = end;
  }
  return out;
}

/** `;` 까지의 연결식을 읽어 리터럴 조각만 이어 붙인다. */
function readValue(text: string, from: number): { value: string; end: number } {
  let i = from;
  let value = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === ';') return { value, end: i + 1 };
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      let buf = '';
      while (j < text.length && text[j] !== quote) {
        if (text[j] === '\\') { buf += text[j] + (text[j + 1] ?? ''); j += 2; continue; }
        buf += text[j]; j++;
      }
      if (j >= text.length) return { value, end: -1 }; // 닫히지 않은 문자열
      value += unescape(buf);
      i = j + 1;
      continue;
    }
    if (ch === '.' || ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { i++; continue; }
    const start = i;
    while (i < text.length && !isBoundary(text[i])) i++;
    if (i === start) i++;              // 진전이 없으면 강제로 전진(무한 루프 방지)
    else value += UNKNOWN_PART;
  }
  return { value, end: -1 };
}

function isBoundary(ch: string): boolean {
  return ch === ';' || ch === '.' || ch === "'" || ch === '"';
}

/** 인용부호·역슬래시 이스케이프만 되돌린다. `\n` 같은 제어 문자는 hover에 그대로 보여도 무해하다. */
function unescape(s: string): string { return s.replace(/\\(['"\\])/g, '$1'); }
