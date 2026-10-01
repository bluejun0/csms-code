import { LangLayout, LangStatement } from '../ports/lang-layout-reader';

export type LangSortResult =
  | { kind: 'sorted'; start: number; end: number; replacement: string }
  | { kind: 'already-sorted' }
  | { kind: 'unsortable'; reason: 'syntax-error' | 'no-strings' | 'shared-line' };

/** UTF-16 코드 단위 순서. 로캘 비교는 `_`·`:`의 자리를 바꿔 Moodle 코어 lang 파일의 순서와 어긋난다. */
export function compareLangKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** 키 순으로 문장을 다시 배열한다. 각 문장은 직전 문장 다음 줄부터 자기 끝 줄까지를 데리고 움직여
 *  위쪽 주석·빈 줄과 같은 줄의 꼬리 주석이 함께 간다. 첫 문장 위(파일 머리말)와 deprecated 표시 뒤는 그대로 둔다. */
export function sortLangStrings(text: string, layout: LangLayout): LangSortResult {
  if (layout.hasSyntaxError) return { kind: 'unsortable', reason: 'syntax-error' };
  const movable = statementsBeforeDeprecated(layout.statements);
  if (!movable.length) return { kind: 'unsortable', reason: 'no-strings' };
  if (movable.some(s => s.sharesLine)) return { kind: 'unsortable', reason: 'shared-line' };

  const order = movable.map((_, i) => i).sort((a, b) => compareLangKeys(movable[a].key, movable[b].key));
  if (order.every((original, position) => original === position)) return { kind: 'already-sorted' };

  const lineStart = lineStartsOf(text);
  const startOfLine = (line: number) => lineStart[line] ?? text.length;
  const chunks = movable.map((s, i) => {
    const from = i === 0 ? s.firstLine : movable[i - 1].lastLine + 1;
    return text.slice(startOfLine(from), startOfLine(s.lastLine + 1));
  });
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const replacement = order.map(i => chunks[i].endsWith('\n') ? chunks[i] : chunks[i] + eol).join('');
  return {
    kind: 'sorted',
    start: startOfLine(movable[0].firstLine),
    end: startOfLine(movable[movable.length - 1].lastLine + 1),
    replacement,
  };
}

function statementsBeforeDeprecated(statements: LangStatement[]): LangStatement[] {
  const cutoff = statements.findIndex(s => s.followsDeprecatedMarker);
  return cutoff < 0 ? statements : statements.slice(0, cutoff);
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}
