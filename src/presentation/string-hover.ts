import * as vscode from 'vscode';
import { HoverResult } from '../application/dto';
import { hoverWithSource } from './source-label';
import { ReferenceCounter, referencesLinkMarkdown } from './string-references-link';

export { ReferenceCounter };

/** 문자열 hover 공통 조립 — 본문 아래에 "사용처 N곳 보기" 링크. 대상이 없는 결과(템플릿 hover 등)는 그대로. */
export function stringHover(doc: vscode.TextDocument, pos: vscode.Position, r: HoverResult, refs: ReferenceCounter): vscode.Hover {
  if (!r.target) return hoverWithSource(r.markdown);
  const args = { uri: doc.uri.toString(), line: pos.line, character: pos.character, ...r.target };
  const count = refs.built() ? refs.count(r.target.component, r.target.key) : null;
  return hoverWithSource(r.markdown, referencesLinkMarkdown(args, count));
}
