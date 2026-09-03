import * as path from 'path';
import Parser from 'web-tree-sitter';
import { Scope } from '../../domain/code-analysis/facts';
import { Captures } from './query-fragment';
import { ScopeTable } from './scope-table';

const SCOPE_TYPES = new Set([
  'function_definition', 'method_declaration',
  'anonymous_function_creation_expression', 'arrow_function',
]);

export type CompiledQuery = Parser.Query;

export interface FragmentMatch { patternIndex: number; captures: Captures }

export interface ClassBodyReader { children(): Parser.SyntaxNode[] }

// web-tree-sitter 0.20.8은 `pattern`, 0.27.0은 `patternIndex`를 쓴다. 어댑터가 둘 다 읽는다.
function patternIndexOf(match: Parser.QueryMatch): number {
  const m = match as unknown as { patternIndex?: number; pattern?: number };
  return m.patternIndex ?? m.pattern ?? 0;
}

class NodeCaptures implements Captures {
  constructor(
    private readonly caps: readonly { name: string; node: Parser.SyntaxNode }[],
    private readonly scopes: ScopeTable,
  ) {}

  private node(name: string): Parser.SyntaxNode | undefined {
    for (const c of this.caps) if (c.name === name) return c.node;
    return undefined;
  }
  private required(name: string): Parser.SyntaxNode {
    const n = this.node(name);
    if (!n) throw new Error(`캡처 ${name}가 없다`);
    return n;
  }

  has(name: string): boolean { return this.node(name) !== undefined; }
  text(name: string): string { return this.required(name).text; }
  index(name: string): number { return this.required(name).startIndex; }
  line(name: string): number { return this.required(name).startPosition.row; }
  column(name: string): number { return this.required(name).startPosition.column; }
  scope(name: string): Scope { return this.scopes.at(this.index(name)); }
  lastNameIn(name: string): string | null {
    const names = this.required(name).descendantsOfType('name');
    const last = names[names.length - 1];
    return last ? last.text : null;
  }
}

export class ParsedDocument {
  constructor(private readonly tree: Parser.Tree) {}

  get endIndex(): number { return this.tree.rootNode.endIndex; }

  scopeRanges(): Scope[] {
    const out: Scope[] = [];
    const stack: Parser.SyntaxNode[] = [this.tree.rootNode];
    while (stack.length) {
      const node = stack.pop()!;
      if (SCOPE_TYPES.has(node.type)) out.push({ start: node.startIndex, end: node.endIndex });
      for (let i = 0; i < node.childCount; i++) stack.push(node.child(i)!);
    }
    return out;
  }

  *run(query: CompiledQuery, scopes: ScopeTable): Iterable<FragmentMatch> {
    for (const match of query.matches(this.tree.rootNode)) {
      yield { patternIndex: patternIndexOf(match), captures: new NodeCaptures(match.captures, scopes) };
    }
  }

  classBody(className: string): ClassBodyReader | null {
    const stack: Parser.SyntaxNode[] = [this.tree.rootNode];
    while (stack.length) {
      const node = stack.pop()!;
      const declares = node.type === 'class_declaration'
        || node.type === 'interface_declaration' || node.type === 'trait_declaration';
      if (declares && node.childForFieldName('name')?.text === className) {
        const body = node.childForFieldName('body');
        if (!body) return null;
        return {
          children: () => {
            const out: Parser.SyntaxNode[] = [];
            for (let i = 0; i < body.childCount; i++) out.push(body.child(i)!);
            return out;
          },
        };
      }
      for (let i = 0; i < node.childCount; i++) stack.push(node.child(i)!);
    }
    return null;
  }

  dispose(): void { this.tree.delete(); }
}

export class PhpRuntime {
  private constructor(private readonly parser: Parser, private readonly language: Parser.Language) {}

  static async create(runtimeDir?: string): Promise<PhpRuntime> {
    const rt = runtimeDir ?? path.join(__dirname, '../../../node_modules/web-tree-sitter');
    const grammar = runtimeDir
      ? path.join(runtimeDir, 'tree-sitter-php.wasm')
      : path.join(__dirname, '../../../node_modules/tree-sitter-wasms/out/tree-sitter-php.wasm');
    await Parser.init({ locateFile: (f: string) => path.join(rt, f) });
    const language = await Parser.Language.load(grammar);
    const parser = new Parser();
    parser.setLanguage(language);
    return new PhpRuntime(parser, language);
  }

  compile(source: string): CompiledQuery { return this.language.query(source); }

  // 중단된 파싱은 파서에 내부 상태를 남겨 다음 문서를 조용히 망가뜨린다.
  parse(text: string): ParsedDocument | null {
    try { return new ParsedDocument(this.parser.parse(text)); }
    catch { this.parser.reset(); return null; }
  }
}
