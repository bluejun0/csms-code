export interface ParsedLangString { key: string; value: string; line: number; }

/** Moodle lang 파일의 `$string['key'] = '값';` 항목 추출.
 *  단일 인용부호 관례만 지원한다(겹따옴표·heredoc 값은 대상 아님), 여러 줄 값 허용. */
export function parseLangFile(text: string): ParsedLangString[] {
  const out: ParsedLangString[] = [];
  const re = /\$string\[\s*'((?:[^'\\]|\\.)+)'\s*\]\s*=\s*'((?:[^'\\]|\\.)*)'\s*;/g;
  let m: RegExpExecArray | null;
  let lastIdx = 0, lastLine = 0; // 증분 라인 계산 — 매치마다 전체 접두부를 재스캔(O(n²))하지 않는다
  while ((m = re.exec(text))) {
    for (let i = lastIdx; i < m.index; i++) if (text.charCodeAt(i) === 10) lastLine++;
    lastIdx = m.index;
    out.push({ key: unescapeSq(m[1]), value: unescapeSq(m[2]), line: lastLine });
  }
  return out;
}

function unescapeSq(s: string): string { return s.replace(/\\(['\\])/g, '$1'); }
