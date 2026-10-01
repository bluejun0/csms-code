import { Node } from 'web-tree-sitter';
import { LangComment, LangLayout, LangStatement, LinePosition } from '../../domain/lang-model/ports/lang-layout-reader';

const STRING_ASSIGNMENTS = new Set(['assignment_expression', 'augmented_assignment_expression']);
const KEY_LITERALS = new Set(['string', 'encapsed_string']);
const NOT_CODE = new Set(['comment', 'php_tag']);

export function readLangLayout(root: Node, text: string): LangLayout {
  const nodes = root.children;
  const lineStarts = lineStartsOf(text);
  const codeLineOf = (node: Node) => node.type === 'text_interpolation' ? inlineHtmlLine(node, text, lineStarts) : node.startPosition.row;
  const statements: LangStatement[] = [];
  const comments: LangComment[] = [];
  let firstCodeLine: number | null = text.startsWith('\uFEFF') ? 0 : null;
  let deprecatedMarker = false;
  nodes.forEach((node, i) => {
    if (node.type === 'comment') {
      comments.push({ line: node.startPosition.row, block: node.text.startsWith('/*') });
      if (/deprecated/i.test(node.text)) deprecatedMarker = true;
      return;
    }
    if (node.type === 'php_tag') return;
    firstCodeLine ??= codeLineOf(node);
    const key = stringKeyOf(node);
    if (key) {
      statements.push({
        key: key.text.slice(1, -1), keyLine: key.startPosition.row,
        start: positionOf(node.startPosition), end: positionOf(node.endPosition),
        nextCodeLine: nextCodeLine(nodes, i, codeLineOf),
        followsDeprecatedMarker: deprecatedMarker,
      });
    }
    deprecatedMarker = false;
  });
  // php-parser는 문법 오류에서 빈 트리로 물러난다 — 문자열·코드·주석 모두 없는 파일로 본다.
  return root.hasError ? { statements: [], firstCodeLine: null, comments: [] } : { statements, firstCodeLine, comments };
}

function stringKeyOf(node: Node): Node | null {
  if (node.type !== 'expression_statement') return null;
  const assignment = node.firstNamedChild;
  if (!assignment || !STRING_ASSIGNMENTS.has(assignment.type)) return null;
  const target = assignment.childForFieldName('left');
  if (target?.type !== 'subscript_expression') return null;
  const [variable, index] = target.namedChildren;
  if (variable?.type !== 'variable_name' || variable.text !== '$string') return null;
  return index && KEY_LITERALS.has(index.type) ? index : null;
}

function nextCodeLine(nodes: Node[], after: number, codeLineOf: (node: Node) => number | null): number | null {
  for (let i = after + 1; i < nodes.length; i++) {
    const line = NOT_CODE.has(nodes[i].type) ? null : codeLineOf(nodes[i]);
    if (line !== null) return line;
  }
  return null;
}

/** `?>` 뒤의 인라인 HTML이 시작하는 줄. PHP는 `?>` 바로 뒤 개행 하나를 태그의 일부로 먹고,
 *  그 뒤로 다음 `<?php`까지 아무 텍스트도 없으면 코드가 아니다. */
function inlineHtmlLine(node: Node, text: string, lineStarts: number[]): number | null {
  const endTag = node.children.find(c => c.type === 'php_end_tag');
  if (!endTag) return node.startPosition.row;
  const from = lineStarts[endTag.endPosition.row] + endTag.endPosition.column;
  const reopen = node.children.find(c => c.type === 'php_tag');
  const to = reopen ? lineStarts[reopen.startPosition.row] + reopen.startPosition.column : text.length;
  const eaten = /^\r?\n/.exec(text.slice(from, to))?.[0].length ?? 0;
  if (from + eaten >= to) return null;
  return endTag.endPosition.row + (eaten ? 1 : 0);
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function positionOf(p: { row: number; column: number }): LinePosition {
  return { line: p.row, character: p.column };
}
