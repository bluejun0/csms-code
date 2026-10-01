import { LangLayout } from '../ports/lang-layout-reader';
import { TextLines } from './text-lines';

/** lang 파일 명령 버튼을 둘 줄: 첫 문자열의 키 줄. 문자열이 없으면 파일 끝 빈 줄, 둘째 줄 이후의 첫 코드,
 *  마지막 주석 덩어리의 첫 주석 순으로 찾고 다 없으면 첫 줄. */
export function langLensLine(text: string, layout: LangLayout): number {
  if (layout.statements.length) return layout.statements[0].keyLine;
  const lines = new TextLines(text);
  if (lines.lastNonEmptyLine() < lines.count - 1) return lines.count - 1;
  if (layout.firstCodeLine !== null && layout.firstCodeLine > 0) return layout.firstCodeLine;
  const comments = layout.comments;
  for (let i = comments.length - 1; i > 0; i--) {
    if (comments[i].block || comments[i].line > comments[i - 1].line + 1) return comments[i].line;
  }
  return comments[0]?.line ?? 0;
}
