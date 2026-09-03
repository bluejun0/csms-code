import Parser from 'web-tree-sitter';
import { RawClassMember } from '../../domain/code-analysis/ports/php-syntax';
import { ClassBodyReader } from './tree-sitter-runtime';

const MAGIC_GET = 'magic_get_';

export function readClassMembers(body: ClassBodyReader): RawClassMember[] {
  const out: RawClassMember[] = [];
  for (const node of body.children()) {
    const member = readMember(node);
    if (member) out.push(member);
  }
  return out;
}

function readMember(node: Parser.SyntaxNode): RawClassMember | null {
  const visibility = childOfType(node, 'visibility_modifier')?.text ?? 'public';
  if (node.type === 'method_declaration') {
    const name = node.childForFieldName('name');
    if (!name) return null;
    if (name.text.startsWith(MAGIC_GET)) {
      // Moodle 관례: magic_get_* 메서드는 protected여도 프로퍼티로 바꿔 보고한다
      return {
        name: name.text.slice(MAGIC_GET.length), kind: 'property',
        signature: '', doc: docBefore(node),
        line: name.startPosition.row, column: name.startPosition.column,
      };
    }
    if (visibility !== 'public') return null;
    return {
      name: name.text, kind: 'method',
      signature: childOfType(node, 'formal_parameters')?.text ?? '()', doc: docBefore(node),
      line: name.startPosition.row, column: name.startPosition.column,
    };
  }
  if (node.type === 'property_declaration') {
    if (visibility !== 'public') return null;
    const element = childOfType(node, 'property_element');
    const name = element ? firstDescendantOfType(element, 'name') : null;
    if (!name) return null;
    return {
      name: name.text, kind: 'property', signature: '', doc: docBefore(node),
      line: name.startPosition.row, column: name.startPosition.column,
    };
  }
  return null;
}

function childOfType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
  for (let i = 0; i < node.childCount; i++) if (node.child(i)!.type === type) return node.child(i);
  return null;
}

function firstDescendantOfType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
  const stack = [node];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.type === type) return n;
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i)!);
  }
  return null;
}

/** 선언 바로 앞 주석 블록의 첫 문장. `@var <타입>` 접두는 설명이 아니므로 떼어낸다. */
function docBefore(node: Parser.SyntaxNode): string {
  const prev = node.previousSibling;
  if (!prev || prev.type !== 'comment') return '';
  const lines = prev.text.replace(/^\/\*+|\*+\/$/g, '').split('\n')
    .map(l => l.replace(/^\s*\*?\s?/, '').trim())
    .filter(l => l.length > 0);
  let first = lines[0] ?? '';
  const varMatch = /^@var\s+\S+\s+(.*)$/.exec(first);
  if (varMatch) first = varMatch[1];
  else if (first.startsWith('@')) return '';
  const stop = first.search(/[.。]/);
  return stop >= 0 ? first.slice(0, stop + 1) : first;
}
