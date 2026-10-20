interface Point { line: number; character: number; }

/** 끌어서 고른 줄 범위(양끝 포함). 다음 줄 첫머리에서 끝난 선택은 그 줄을 고른 것이 아니다. */
export function selectedLines(selection: { start: Point; end: Point }): { first: number; last: number } {
  const endsAtLineStart = selection.end.character === 0 && selection.end.line > selection.start.line;
  return { first: selection.start.line, last: endsAtLineStart ? selection.end.line - 1 : selection.end.line };
}
