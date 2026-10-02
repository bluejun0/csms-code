import { LangLayout, LangStatement, LinePosition } from '../ports/lang-layout-reader';
import { TextLines } from './text-lines';

export interface TextReplacement { start: number; end: number; replacement: string; }

/** UTF-16 코드 단위 순서. 로캘 비교는 `_`·`:`의 자리를 바꿔 Moodle 코어 lang 파일의 순서와 어긋난다. */
export function compareLangKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** deprecated 표시 앞의 문자열을 키 순으로. 문자열이 없으면 null. */
export function sortAlphabetically(text: string, layout: LangLayout): TextReplacement | null {
  const lines = new TextLines(text);
  const chunks = chunksOf(lines, layout.statements);
  const cutoff = chunks.findIndex(c => c.statement.followsDeprecatedMarker);
  const movable = cutoff < 0 ? chunks : chunks.slice(0, cutoff);
  if (!movable.length) return null;
  return rearrange(lines, movable, [...movable].sort((a, b) => compareLangKeys(a.statement.key, b.statement.key)));
}

/** 모든 문자열을 영어 파일의 키 순서로. 영어 파일에 없는 키는 원래 순서대로 맨 뒤. 문자열이 없으면 null. */
export function sortInEnglishOrder(text: string, layout: LangLayout, englishLayout: LangLayout): TextReplacement | null {
  const lines = new TextLines(text);
  const chunks = chunksOf(lines, layout.statements);
  if (!chunks.length) return null;
  const rank = new Map<string, number>();
  englishLayout.statements.forEach((s, i) => rank.set(s.key, i));
  const rankOf = (c: Chunk) => rank.get(c.statement.key) ?? rank.size;
  return rearrange(lines, chunks, [...chunks].sort((a, b) => rankOf(a) - rankOf(b)));
}

/** 영어 파일에만 있는 문자열을 위 주석과 함께 마지막 비어 있지 않은 줄 뒤에 덧붙인다. */
export function missingTranslations(text: string, layout: LangLayout, englishText: string, englishLayout: LangLayout):
  { insertAt: number; insertion: string; count: number } | null {
  const present = new Set(layout.statements.map(s => s.key));
  const english = new TextLines(englishText);
  const missing = chunksOf(english, englishLayout.statements).filter(c => !present.has(c.statement.key));
  if (!missing.length) return null;
  const lines = new TextLines(text);
  const lastFilled = lines.lastNonEmptyLine();
  const lead = lastFilled === lines.count - 1 ? '\n\n' : '\n';
  const body = missing.map(c => english.slice(c) + (c.endsWithoutNewline ? '\n' : '')).join('');
  return {
    insertAt: lines.offsetAt({ line: lastFilled + 1, character: 0 }),
    insertion: (lead + body).replace(/\r\n|\r|\n/g, lines.eol),
    count: missing.length,
  };
}

interface Chunk { statement: LangStatement; start: LinePosition; end: LinePosition; endsWithoutNewline: boolean; }

/** 문장마다 옮길 구간: 다음 코드나 다음 문자열이 아래 줄에 있으면 줄 끝(꼬리 주석 포함)까지, 줄 첫머리에서
 *  시작하면 직전 구간 끝부터(위쪽 주석·빈 줄 포함). 다음 코드와 줄을 나눠 쓰거나 파일 끝이면 문장 끝에서
 *  멈추고 옮길 때 개행을 붙인다. */
function chunksOf(lines: TextLines, statements: LangStatement[]): Chunk[] {
  const chunks: Chunk[] = [];
  statements.forEach((statement, i) => {
    const nextLineStart = { line: statement.end.line + 1, character: 0 };
    const nextString = statements[i + 1];
    let end = statement.end;
    let endsWithoutNewline = false;
    if (statement.nextCodeLine !== null && statement.nextCodeLine > statement.end.line) end = nextLineStart;
    else if (nextString && nextString.keyLine > statement.end.line) end = nextLineStart;
    else if (statement.nextCodeLine !== null) endsWithoutNewline = true;
    else if (statement.end.line < lines.count - 1) end = nextLineStart;
    else endsWithoutNewline = true;
    const previous = chunks[chunks.length - 1];
    const absorbsGap = previous && statement.start.character === 0
      && previous.end.character === 0 && previous.end.line < statement.start.line;
    chunks.push({ statement, start: absorbsGap ? previous.end : statement.start, end, endsWithoutNewline });
  });
  return chunks;
}

/** 구간을 모두 지우고 새 순서의 첫 구간이 있던 자리에 모아 넣는다. 구간 사이에 남는 텍스트는 제자리에 둔다. */
function rearrange(lines: TextLines, chunks: Chunk[], ordered: Chunk[]): TextReplacement {
  const block = ordered.map(c => lines.slice(c) + (c.endsWithoutNewline ? lines.eol : '')).join('');
  const insertAt = lines.offsetAt(ordered[0].start);
  const start = lines.offsetAt(chunks[0].start);
  const end = lines.offsetAt(chunks[chunks.length - 1].end);
  let replacement = '';
  let cursor = start;
  for (const c of chunks) {
    const from = lines.offsetAt(c.start);
    if (from === insertAt) replacement += lines.text.slice(cursor, from) + block;
    else replacement += lines.text.slice(cursor, from);
    cursor = lines.offsetAt(c.end);
  }
  return { start, end, replacement };
}
