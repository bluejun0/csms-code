import { Node } from 'web-tree-sitter';
import { ClassOutline } from '../../domain/code-analysis/ports/class-outline-reader';

const CLASS_LIKE = new Set(['class_declaration', 'interface_declaration', 'trait_declaration']);
const FUNCTION_BODIES = new Set(['function_definition', 'method_declaration', 'anonymous_function', 'arrow_function']);

/** `if (!class_exists(...)) { class … }`처럼 블록 안에 둔 선언도 찾는다. 함수 본문 안은 보지 않는다. */
export function readClassOutlines(root: Node): ClassOutline[] {
  const out: ClassOutline[] = [];
  const visit = (node: Node, scope: NameScope) => {
    for (const child of node.children) {
      if (child.type === 'namespace_definition') {
        const name = child.childForFieldName('name')?.text ?? '';
        const body = child.childForFieldName('body');
        if (body) visit(body, { namespace: name, imports: new Map() });
        else scope = { namespace: name, imports: new Map() };
      } else if (child.type === 'namespace_use_declaration') {
        addImports(child, scope.imports);
      } else if (CLASS_LIKE.has(child.type)) {
        const name = child.childForFieldName('name');
        if (name) out.push(outlineOf(child, name, scope));
      } else if (!FUNCTION_BODIES.has(child.type) && child.childCount) {
        visit(child, scope);
      }
    }
  };
  visit(root, { namespace: '', imports: new Map() });
  return out;
}

interface NameScope { namespace: string; imports: Map<string, string>; }

/** 클래스 `use`만 담는다 — `use function`·`use const`는 클래스 이름이 아니다. */
function addImports(declaration: Node, imports: Map<string, string>): void {
  if (declaration.children.some(c => c.type === 'function' || c.type === 'const')) return;
  for (const clause of declaration.namedChildren) {
    if (clause.type !== 'namespace_use_clause') continue;
    const target = clause.namedChildren.find(c => c.type === 'qualified_name' || c.type === 'name');
    if (!target) continue;
    const full = target.text.replace(/^\\/, '');
    const alias = clause.childForFieldName('alias')?.text ?? full.split('\\').pop()!;
    imports.set(alias.toLowerCase(), full);
  }
}

/** PHP 이름 해석: `\`로 시작하면 전체 이름, 첫 조각이 `use` 별칭이면 그것으로, 아니면 현재 네임스페이스 기준. */
function resolveName(raw: string, scope: NameScope): string {
  if (raw.startsWith('\\')) return raw.slice(1);
  const [first, ...rest] = raw.split('\\');
  const imported = scope.imports.get(first.toLowerCase());
  if (imported) return [imported, ...rest].join('\\');
  return scope.namespace ? `${scope.namespace}\\${raw}` : raw;
}

function outlineOf(declaration: Node, name: Node, scope: NameScope): ClassOutline {
  const methods = (declaration.childForFieldName('body')?.namedChildren ?? [])
    .filter(member => member.type === 'method_declaration')
    .flatMap(member => {
      const methodName = member.childForFieldName('name');
      return methodName ? [{ name: methodName.text, line: methodName.startPosition.row, column: methodName.startPosition.column }] : [];
    });
  const base = declaration.namedChildren.find(c => c.type === 'base_clause')?.namedChildren[0];
  return {
    name: scope.namespace ? `${scope.namespace}\\${name.text}` : name.text,
    line: name.startPosition.row, column: name.startPosition.column,
    parent: base ? resolveName(base.text, scope) : null,
    methods,
  };
}
