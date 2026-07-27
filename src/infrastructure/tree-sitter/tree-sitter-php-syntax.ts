import * as path from 'path';
import Parser from 'web-tree-sitter';
import {
  DocumentFacts, RecordAssignment, ForeachBinding, DataArgBinding, PhpdocVar, PropertyAccess, Scope,
} from '../../domain/code-analysis/facts';
import { PhpSyntax } from '../../domain/code-analysis/ports/php-syntax';

const SCOPE_TYPES = new Set([
  'function_definition', 'method_declaration',
  'anonymous_function_creation_expression', 'arrow_function',
]);

// 검증된 쿼리 (스파이크 2026-07-27)
const Q_ASSIGN = `
  (assignment_expression
    left: (variable_name (name) @var)
    right: (member_call_expression
      object: (variable_name (name) @recv)
      name: (name) @method
      arguments: (arguments . (argument (string (string_content) @table)))))`;
const Q_ASSIGN_NOTABLE = `
  (assignment_expression
    left: (variable_name (name) @var)
    right: (member_call_expression
      object: (variable_name (name) @recv)
      name: (name) @method))`;
const Q_FOREACH = `
  (foreach_statement (variable_name (name) @collection) (variable_name (name) @item))`;
const Q_PROP = `
  (member_access_expression object: (variable_name (name) @var) name: (name) @prop)`;
const Q_DATAARG = `
  (member_call_expression
    name: (name) @method
    arguments: (arguments . (argument (string (string_content) @table)) (argument (variable_name (name) @datavar))))`;

export class TreeSitterPhpSyntax implements PhpSyntax {
  private constructor(private parser: Parser, private lang: Parser.Language) {}

  /** runtimeDir: tree-sitter.wasm + tree-sitter-php.wasm 이 있는 폴더(dist). 테스트에선 node_modules. */
  static async create(runtimeDir?: string): Promise<TreeSitterPhpSyntax> {
    const rt = runtimeDir ?? path.join(__dirname, '../../../node_modules/web-tree-sitter');
    const phpWasm = runtimeDir
      ? path.join(runtimeDir, 'tree-sitter-php.wasm')
      : path.join(__dirname, '../../../node_modules/tree-sitter-wasms/out/tree-sitter-php.wasm');
    await Parser.init({ locateFile: (f: string) => path.join(rt, f) });
    const lang = await Parser.Language.load(phpWasm);
    const parser = new Parser(); parser.setLanguage(lang);
    return new TreeSitterPhpSyntax(parser, lang);
  }

  facts(text: string): DocumentFacts {
    const tree = this.parser.parse(text);
    const root = tree.rootNode;
    const scopeOf = (node: Parser.SyntaxNode): Scope => {
      let p: Parser.SyntaxNode | null = node;
      while (p) { if (SCOPE_TYPES.has(p.type)) return { start: p.startIndex, end: p.endIndex }; p = p.parent; }
      return { start: 0, end: root.endIndex };
    };
    const capMap = (caps: { name: string; node: Parser.SyntaxNode }[]) => {
      const m = new Map<string, Parser.SyntaxNode>();
      for (const c of caps) m.set(c.name, c.node);
      return m;
    };
    // matches() 로 한 매치 내 캡처들을 묶는다
    const runMatches = (q: string) => this.lang.query(q).matches(root)
      .map(mt => ({ caps: capMap(mt.captures), anchor: mt.captures[0].node }));

    const assignments: RecordAssignment[] = [];
    for (const { caps } of runMatches(Q_ASSIGN)) {
      const varN = caps.get('var')!, recv = caps.get('recv')!, method = caps.get('method')!, table = caps.get('table');
      assignments.push({ varName: varN.text, receiver: recv.text, method: method.text,
        tableArg: table ? table.text : null, index: varN.startIndex, scope: scopeOf(varN) });
    }
    // 테이블 인자가 없는(get_record_sql 등) 대입도 잡아, 이미 잡힌 var는 제외
    const seen = new Set(assignments.map(a => a.index));
    for (const { caps } of runMatches(Q_ASSIGN_NOTABLE)) {
      const varN = caps.get('var')!;
      if (seen.has(varN.startIndex)) continue;
      assignments.push({ varName: varN.text, receiver: caps.get('recv')!.text, method: caps.get('method')!.text,
        tableArg: null, index: varN.startIndex, scope: scopeOf(varN) });
    }

    const foreachBindings: ForeachBinding[] = runMatches(Q_FOREACH).map(({ caps }) => {
      const item = caps.get('item')!;
      return { collectionVar: caps.get('collection')!.text, itemVar: item.text, index: item.startIndex, scope: scopeOf(item) };
    });

    const dataArgBindings: DataArgBinding[] = runMatches(Q_DATAARG).map(({ caps }) => {
      const dv = caps.get('datavar')!;
      return { method: caps.get('method')!.text, tableArg: caps.get('table')!.text, dataVar: dv.text, index: dv.startIndex, scope: scopeOf(dv) };
    });

    const propertyAccesses: PropertyAccess[] = runMatches(Q_PROP).map(({ caps }) => {
      const v = caps.get('var')!, p = caps.get('prop')!;
      return { varName: v.text, property: p.text, propLine: p.startPosition.row, propColumn: p.startPosition.column,
        propIndex: p.startIndex, index: v.startIndex, scope: scopeOf(v) };
    });

    const phpdocVars = extractPhpdocVars(text, root, scopeOf);

    return { assignments, foreachBindings, dataArgBindings, phpdocVars, propertyAccesses };
  }
}

/** @var Type $x — comment 노드 텍스트에 정규식(트리시터가 phpdoc 내부를 파싱 안 함) */
function extractPhpdocVars(text: string, root: Parser.SyntaxNode, scopeOf: (n: Parser.SyntaxNode) => Scope): PhpdocVar[] {
  const out: PhpdocVar[] = [];
  const re = /@var\s+([^\s]+)\s+\$(\w+)/g;
  const walk = (n: Parser.SyntaxNode) => {
    if (n.type === 'comment') {
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(n.text))) out.push({ typeText: m[1], varName: m[2], index: n.startIndex, scope: scopeOf(n) });
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  };
  walk(root);
  return out;
}
