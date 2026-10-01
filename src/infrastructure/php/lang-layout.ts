import { Node } from 'web-tree-sitter';
import { LangLayout, LangStatement } from '../../domain/lang-model/ports/lang-layout-reader';

const STRING_ASSIGNMENTS = new Set(['assignment_expression', 'augmented_assignment_expression']);
const KEY_LITERALS = new Set(['string', 'encapsed_string']);

export function readLangLayout(root: Node): LangLayout {
  const nodes = root.children;
  const statements: LangStatement[] = [];
  let previousCodeEndRow = -1;
  let deprecatedMarker = false;
  nodes.forEach((node, i) => {
    if (node.type === 'comment') {
      if (/deprecated/i.test(node.text)) deprecatedMarker = true;
      return;
    }
    const key = stringKeyOf(node);
    if (key !== null) {
      const firstLine = node.startPosition.row;
      const lastLine = node.endPosition.row;
      statements.push({
        key, firstLine, lastLine,
        sharesLine: firstLine === previousCodeEndRow || nextCodeStartRow(nodes, i) === lastLine,
        followsDeprecatedMarker: deprecatedMarker,
      });
    }
    deprecatedMarker = false;
    previousCodeEndRow = node.endPosition.row;
  });
  return { statements, hasSyntaxError: root.hasError };
}

function stringKeyOf(node: Node): string | null {
  if (node.type !== 'expression_statement') return null;
  const assignment = node.firstNamedChild;
  if (!assignment || !STRING_ASSIGNMENTS.has(assignment.type)) return null;
  const target = assignment.childForFieldName('left');
  if (target?.type !== 'subscript_expression') return null;
  const [variable, index] = target.namedChildren;
  if (variable?.type !== 'variable_name' || variable.text !== '$string') return null;
  if (!index || !KEY_LITERALS.has(index.type)) return null;
  return index.text.slice(1, -1);
}

function nextCodeStartRow(nodes: Node[], after: number): number | null {
  for (let i = after + 1; i < nodes.length; i++) {
    if (nodes[i].type !== 'comment') return nodes[i].startPosition.row;
  }
  return null;
}
