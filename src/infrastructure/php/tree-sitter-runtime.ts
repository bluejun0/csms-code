import * as path from 'path';
import { Language, Node, Parser, Query, QueryMatch, Tree } from 'web-tree-sitter';
import { Scope } from '../../domain/code-analysis/facts';
import { Captures } from './query-fragment';
import { ScopeTable } from './scope-table';

// tree-sitter-php 0.24.2에서 익명 함수 노드 이름이 anonymous_function_creation_expression에서
// anonymous_function으로 바뀌었다.
const SCOPE_TYPES = new Set([
  'function_definition', 'method_declaration',
  'anonymous_function', 'arrow_function',
]);

export type CompiledQuery = Query;

export interface FragmentMatch { patternIndex: number; captures: Captures }

export interface ClassBodyReader { children(): Node[] }

// web-tree-sitter 0.20.8은 `pattern`, 0.27.0은 `patternIndex`를 쓴다. 어댑터가 둘 다 읽는다.
// 기본값을 0으로 두면 셋째 이름으로 또 바뀌었을 때 모든 매치가 조용히 패턴 0으로
// 오분류된다 — 조각 설계 전체가 막으려는 바로 그 실패라 값 대신 예외로 드러낸다.
function patternIndexOf(match: QueryMatch): number {
  const m = match as unknown as { patternIndex?: number; pattern?: number };
  if (m.patternIndex !== undefined) return m.patternIndex;
  if (m.pattern !== undefined) return m.pattern;
  throw new Error('QueryMatch에 patternIndex도 pattern도 없다 — web-tree-sitter API가 바뀌었다');
}

class NodeCaptures implements Captures {
  constructor(
    private readonly caps: readonly { name: string; node: Node }[],
    private readonly scopes: ScopeTable,
  ) {}

  private node(name: string): Node | undefined {
    for (const c of this.caps) if (c.name === name) return c.node;
    return undefined;
  }
  private required(name: string): Node {
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
  constructor(private readonly tree: Tree) {}

  get endIndex(): number { return this.tree.rootNode.endIndex; }

  scopeRanges(): Scope[] {
    const out: Scope[] = [];
    const stack: Node[] = [this.tree.rootNode];
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
    const stack: Node[] = [this.tree.rootNode];
    while (stack.length) {
      const node = stack.pop()!;
      const declares = node.type === 'class_declaration'
        || node.type === 'interface_declaration' || node.type === 'trait_declaration';
      if (declares && node.childForFieldName('name')?.text === className) {
        const body = node.childForFieldName('body');
        if (!body) return null;
        return {
          children: () => {
            const out: Node[] = [];
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
  private constructor(private readonly parser: Parser, private readonly language: Language) {}

  static async create(runtimeDir?: string): Promise<PhpRuntime> {
    const rt = runtimeDir ?? path.join(__dirname, '../../../node_modules/web-tree-sitter');
    const grammar = runtimeDir
      ? path.join(runtimeDir, 'tree-sitter-php.wasm')
      : path.join(__dirname, '../../../node_modules/tree-sitter-php/tree-sitter-php.wasm');
    await Parser.init({ locateFile: (f: string) => path.join(rt, f) });
    const language = await Language.load(grammar);
    const parser = new Parser();
    parser.setLanguage(language);
    return new PhpRuntime(parser, language);
  }

  compile(source: string): CompiledQuery { return new Query(this.language, source); }

  // tree-sitter는 오류 복구 문법이라 PHP 텍스트 내용만으로는 여기서 null도 예외도 만들 수
  // 없다(16진 이스케이프·깊은 중첩·NUL 바이트·깨진 UTF-16·불균형 중괄호 등을 직접 확인함 —
  // 전부 ERROR 노드를 포함한 트리로 성공한다). 그래도 이 try/catch·reset()을 남겨두는 건
  // 텍스트가 아니라 런타임 자체의 실패(예: wasm 메모리 부족, 향후 라이브러리 버그)에 대비하기
  // 위해서다 — 중단된 파싱은 파서에 내부 상태를 남겨 다음 문서를 조용히 망가뜨리므로, 어떤
  // 이유로든 실패하면 reset()으로 그 상태부터 지운다.
  parse(text: string): ParsedDocument | null {
    try {
      const tree = this.parser.parse(text);
      if (!tree) { this.parser.reset(); return null; }
      return new ParsedDocument(tree);
    } catch {
      this.parser.reset();
      return null;
    }
  }
}
