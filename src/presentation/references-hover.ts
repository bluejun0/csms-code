import * as vscode from 'vscode';
import { HoverResult } from '../application/dto';
import { hoverWithSource } from './source-label';
import { ReferenceCounters, commandForKind, referencesLinkMarkdown } from './references-link';

export { ReferenceCounter, ReferenceCounters } from './references-link';

/** 참조 대상이 있는 hover 공통 조립 — 본문 아래에 "사용 N건 보기" 링크. 대상이 없는 결과(템플릿 hover 등)는 그대로. */
export function hoverWithReferences(doc: vscode.TextDocument, pos: vscode.Position, r: HoverResult, counters: ReferenceCounters): vscode.Hover {
  if (!r.target) return hoverWithSource(r.markdown);
  const counter = counters[r.target.kind];
  const args = { uri: doc.uri.toString(), line: pos.line, character: pos.character, component: r.target.component, key: r.target.key };
  const count = counter.built() ? counter.count(r.target.component, r.target.key) : null;
  return hoverWithSource(r.markdown, referencesLinkMarkdown(commandForKind(r.target.kind), args, count));
}
