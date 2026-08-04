export interface ParsedLangString { key: string; value: string; line: number; }

/** Moodle lang 파일의 `$string['key'] = '값';` 항목 추출.
 *  단일 인용부호 관례만 지원(double-quoted·heredoc은 스펙 비목표), 여러 줄 값 허용. */
export function parseLangFile(text: string): ParsedLangString[] {
  const out: ParsedLangString[] = [];
  const re = /\$string\[\s*'((?:[^'\\]|\\.)+)'\s*\]\s*=\s*'((?:[^'\\]|\\.)*)'\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const line = text.slice(0, m.index).split('\n').length - 1;
    out.push({ key: unescapeSq(m[1]), value: unescapeSq(m[2]), line });
  }
  return out;
}

function unescapeSq(s: string): string { return s.replace(/\\(['\\])/g, '$1'); }
