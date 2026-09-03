# 문법 계층 재작성 구현 계획 (1단계)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PHP 문법 계층을 쿼리 조각 + 통합 쿼리 구조로 다시 만들어 `facts()`를 17.0ms에서 4~5ms로 낮추고, 16진 이스케이프가 든 파일에서 인텔리전스가 침묵하지 않게 한다.

**Architecture:** 쿼리 조각 하나가 최상위 패턴 하나와 그 매치를 팩트로 옮기는 `collect()`를 갖는다. 조각들을 하나의 tree-sitter 쿼리로 합쳐 컴파일하고, 매치의 패턴 인덱스로 조각을 되찾아 분기한다. 조각은 tree-sitter 타입을 모르고 `Captures`·`FactSink` 두 인터페이스만 본다. `PhpSyntax` 포트와 `DocumentFacts`는 고정이므로 26개 유스케이스와 기존 단위 테스트가 회귀 게이트가 된다.

**Tech Stack:** TypeScript, web-tree-sitter, mocha + ts-node, esbuild

**Spec:** `docs/superpowers/specs/2026-09-03-parser-rewrite-design.md`

## Global Constraints

- `PhpSyntax` 포트와 `DocumentFacts`의 필드 이름·타입은 바꾸지 않는다. 유일한 변경은 `facts(text, need?)`의 선택 인자 추가이며 기본값은 전체다.
- `Parser.SyntaxNode` 등 tree-sitter 타입은 `src/infrastructure/php/` 밖으로 나가지 않는다.
- 주석은 최소로 쓴다. 이름·함수 분리·타입으로 설명하고, 코드에서 읽어낼 수 없는 사실(문법·런타임 제약, 불변 조건, 대안이 안 되는 이유)만 주석으로 남긴다.
- 주석에 날짜·리뷰·백로그 번호 등 개발 과정 참조를 쓰지 않는다.
- 조각은 최상위 패턴을 정확히 하나만 갖는다. `FragmentSet.of`가 생성 시점에 단정한다.
- 기능 동작은 현행 유지다. 16진 이스케이프 파일이 침묵에서 벗어나는 것만 관찰 가능한 변화다.
- 각 태스크는 `npm run test:unit`과 `npx tsc -noEmit`이 통과한 상태로 끝난다.
- 실측 코퍼스 경로는 환경 변수 `CSMS_CORPUS`로 받고, 없으면 그 테스트는 건너뛴다(CI 통과 보장).

## 파일 구성

**새로 만드는 것**

| 파일 | 책임 |
|---|---|
| `src/infrastructure/php/query-fragment.ts` | `FactKind`·`Captures`·`FactSink`·`QueryFragment` 타입, `topLevelPatternCount` |
| `src/infrastructure/php/scope-table.ts` | 스코프 구간 테이블과 인덱스 조회 |
| `src/infrastructure/php/tree-sitter-runtime.ts` | Parser 생성, 파싱 실패 격리, 매치 → `Captures` 변환, 패턴 인덱스 필드 흡수 |
| `src/infrastructure/php/fragment-set.ts` | 조각 목록 → 통합 소스, 패턴 인덱스 → 조각 분기, `need` 필터 |
| `src/infrastructure/php/fragments/record.ts` | 레코드 대입·foreach·dataArg·plainAssign |
| `src/infrastructure/php/fragments/access.ts` | 프로퍼티 접근·메서드 호출·phpdoc |
| `src/infrastructure/php/fragments/strings.ts` | 문자열 호출(리터럴·동적)과 리터럴 출처 |
| `src/infrastructure/php/fragments/config.ts` | `get_config`·`set_config`(리터럴·동적) |
| `src/infrastructure/php/fragments/tables.ts` | 문자열 본문의 `{table}`·`$DB` 첫 인자 |
| `src/infrastructure/php/fragments/templates.ts` | `render_from_template`·`js_call_amd` |
| `src/infrastructure/php/class-members.ts` | `classMembers` 구현 |
| `src/infrastructure/php/php-syntax.ts` | 조립 — 파싱·스코프·통합 쿼리·정규화 |
| `src/infrastructure/php/facts-cache.ts` | `need` 조합까지 키에 넣는 LRU |
| `test/tools/facts-diff.ts` | 두 `PhpSyntax` 구현의 `DocumentFacts`를 코퍼스에서 비교 |

**삭제하는 것** (Task 16)

- `src/infrastructure/tree-sitter/tree-sitter-php-syntax.ts`
- `src/infrastructure/caching/cached-php-syntax.ts`
- `test/unit/infra/tree-sitter.test.ts`, `test/unit/infra/cached-php-syntax.test.ts` (새 위치의 테스트가 대체)

**수정하는 것**

- `src/extension.ts` — 새 구현으로 배선 (Task 16)
- `esbuild.mjs`, `package.json` — 런타임·문법 업그레이드 (Task 17)

---

### Task 1: 조각 타입과 최상위 패턴 계수

**Files:**
- Create: `src/infrastructure/php/query-fragment.ts`
- Modify: `src/domain/code-analysis/facts.ts` (`FactKind` 추가)
- Modify: `src/domain/code-analysis/ports/php-syntax.ts` (`facts`에 `need` 선택 인자)
- Test: `test/unit/php/query-fragment.test.ts`

**Interfaces:**
- Consumes: `DocumentFacts`, `Scope` (`src/domain/code-analysis/facts.ts`)
- Produces: `FactKind` (도메인), `Captures`, `FactSink`, `QueryFragment`, `topLevelPatternCount(pattern: string): number`

`FactKind`는 `DocumentFacts`의 필드 이름이므로 도메인에 둔다. 포트가 `need`를 선언해야 `CachedPhpSyntax`가
`PhpSyntax` 타입의 `inner`에 `need`를 넘길 수 있다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// test/unit/php/query-fragment.test.ts
import { strict as assert } from 'assert';
import { topLevelPatternCount } from '../../../src/infrastructure/php/query-fragment';

describe('topLevelPatternCount', () => {
  it('패턴 하나', () => {
    assert.equal(topLevelPatternCount('(variable_name (name) @v)'), 1);
  });
  it('패턴 둘', () => {
    assert.equal(topLevelPatternCount('(string_content) @s\n(nowdoc_string) @s'), 2);
  });
  it('중첩된 대괄호 대안은 하나로 센다', () => {
    assert.equal(topLevelPatternCount('(object_creation_expression [(name) @c (qualified_name (name) @c)])'), 1);
  });
  it('문자열 안의 괄호는 세지 않는다', () => {
    assert.equal(topLevelPatternCount('(member_call_expression name: (name) @m (#eq? @m "f(x)"))'), 1);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx mocha test/unit/php/query-fragment.test.ts`
Expected: FAIL — `Cannot find module '.../query-fragment'`

- [ ] **Step 3: 구현한다**

`src/domain/code-analysis/facts.ts` 맨 아래에 더한다.

```ts
export type FactKind = keyof DocumentFacts;
```

`src/domain/code-analysis/ports/php-syntax.ts`의 `facts` 시그니처를 바꾼다.

```ts
import { DocumentFacts, FactKind } from '../facts';

export interface PhpSyntax {
  facts(text: string, need?: ReadonlySet<FactKind>): DocumentFacts;
  classMembers(text: string, className: string): RawClassMember[];
}
```

```ts
// src/infrastructure/php/query-fragment.ts
import { DocumentFacts, FactKind, Scope } from '../../domain/code-analysis/facts';

export type { FactKind };

export interface Captures {
  has(name: string): boolean;
  text(name: string): string;
  index(name: string): number;
  line(name: string): number;
  column(name: string): number;
  scope(name: string): Scope;
  lastNameIn(name: string): string | null;
}

export interface FactSink {
  add<K extends FactKind>(kind: K, fact: DocumentFacts[K][number]): void;
}

export interface QueryFragment {
  readonly produces: readonly FactKind[];
  readonly pattern: string;
  collect(at: Captures, into: FactSink): void;
}

export function topLevelPatternCount(pattern: string): number {
  let depth = 0;
  let count = 0;
  let inString = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '(' || ch === '[') { if (depth === 0) count++; depth++; }
    else if (ch === ')' || ch === ']') depth--;
  }
  return count;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx mocha test/unit/php/query-fragment.test.ts`
Expected: PASS (4 passing)

- [ ] **Step 5: 포트 변경이 기존 구현·테스트를 깨지 않는지 확인한다**

옛 `TreeSitterPhpSyntax`와 옛 `CachedPhpSyntax`, 그 테스트의 `CountingFake`가 모두 `facts(text)`만 선언한다.
인자가 적은 구현은 TypeScript에서 여전히 할당 가능하지만, 확인 없이 넘어가지 않는다.

```bash
npx tsc -noEmit && npm run test:unit
```
Expected: 둘 다 통과. 실패하면 그 파일의 `facts` 시그니처에 `need?: ReadonlySet<FactKind>`를 더한다.

- [ ] **Step 6: 커밋**

```bash
git add src/infrastructure/php/query-fragment.ts src/domain/code-analysis/facts.ts \
  src/domain/code-analysis/ports/php-syntax.ts test/unit/php/query-fragment.test.ts
git commit -m "feat: 쿼리 조각 타입과 최상위 패턴 계수"
```

---

### Task 2: 스코프 구간 테이블

**Files:**
- Create: `src/infrastructure/php/scope-table.ts`
- Test: `test/unit/php/scope-table.test.ts`

**Interfaces:**
- Consumes: `Scope`
- Produces: `ScopeTable.of(ranges: readonly Scope[], documentEnd: number): ScopeTable`, `table.at(index: number): Scope`

`at()`은 인덱스를 포함하는 **가장 안쪽** 구간을 준다. 어느 구간에도 들지 않으면 `{ start: 0, end: documentEnd }`를 준다 — 현행 `scopeOf`의 최상위 스크립트 폴백과 같은 값이다. `record-type-inference`가 `sameScope`로 `start`·`end` 값 동일성을 비교하므로 값이 정확히 같아야 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// test/unit/php/scope-table.test.ts
import { strict as assert } from 'assert';
import { ScopeTable } from '../../../src/infrastructure/php/scope-table';

describe('ScopeTable', () => {
  const table = ScopeTable.of([
    { start: 0, end: 100 },
    { start: 10, end: 20 },
    { start: 30, end: 60 },
    { start: 40, end: 50 },
  ], 200);

  it('가장 안쪽 구간을 준다', () => {
    assert.deepEqual(table.at(45), { start: 40, end: 50 });
  });
  it('안쪽 구간 밖이면 바깥 구간으로 올라간다', () => {
    assert.deepEqual(table.at(55), { start: 30, end: 60 });
    assert.deepEqual(table.at(25), { start: 0, end: 100 });
  });
  it('어느 구간에도 없으면 문서 전체', () => {
    assert.deepEqual(table.at(150), { start: 0, end: 200 });
  });
  it('구간 시작 위치는 그 구간에 든다', () => {
    assert.deepEqual(table.at(40), { start: 40, end: 50 });
  });
  it('구간이 없으면 언제나 문서 전체', () => {
    assert.deepEqual(ScopeTable.of([], 80).at(5), { start: 0, end: 80 });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx mocha test/unit/php/scope-table.test.ts`
Expected: FAIL — `Cannot find module '.../scope-table'`

- [ ] **Step 3: 구현한다**

```ts
// src/infrastructure/php/scope-table.ts
import { Scope } from '../../domain/code-analysis/facts';

export class ScopeTable {
  private constructor(
    private readonly ranges: readonly Scope[],
    private readonly enclosing: readonly number[],
    private readonly documentEnd: number,
  ) {}

  static of(ranges: readonly Scope[], documentEnd: number): ScopeTable {
    const sorted = [...ranges].sort((a, b) => a.start - b.start || b.end - a.end);
    const enclosing: number[] = [];
    const open: number[] = [];
    sorted.forEach((range, i) => {
      while (open.length && sorted[open[open.length - 1]].end <= range.start) open.pop();
      enclosing[i] = open.length ? open[open.length - 1] : -1;
      open.push(i);
    });
    return new ScopeTable(sorted, enclosing, documentEnd);
  }

  at(index: number): Scope {
    for (let i = this.lastStartingAtOrBefore(index); i >= 0; i = this.enclosing[i]) {
      if (this.ranges[i].end > index) return this.ranges[i];
    }
    return { start: 0, end: this.documentEnd };
  }

  private lastStartingAtOrBefore(index: number): number {
    let lo = 0;
    let hi = this.ranges.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.ranges[mid].start <= index) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found;
  }
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx mocha test/unit/php/scope-table.test.ts`
Expected: PASS (5 passing)

- [ ] **Step 5: 커밋**

```bash
git add src/infrastructure/php/scope-table.ts test/unit/php/scope-table.test.ts
git commit -m "feat: 스코프 구간 테이블"
```

---

### Task 3: tree-sitter 런타임 어댑터

**Files:**
- Create: `src/infrastructure/php/tree-sitter-runtime.ts`
- Test: `test/unit/php/tree-sitter-runtime.test.ts`

**Interfaces:**
- Consumes: `Captures` (Task 1), `ScopeTable` (Task 2)
- Produces:
  - `PhpRuntime.create(runtimeDir?: string): Promise<PhpRuntime>`
  - `runtime.compile(source: string): CompiledQuery`
  - `runtime.parse(text: string): ParsedDocument | null` — 실패 시 `null`, 파서 상태를 버린다
  - `ParsedDocument`: `{ endIndex: number; scopeRanges(): Scope[]; run(query: CompiledQuery, scopes: ScopeTable): Iterable<FragmentMatch>; classBody(className: string): ClassBodyReader | null; dispose(): void }`
  - `FragmentMatch`: `{ patternIndex: number; captures: Captures }`

패턴 인덱스는 `web-tree-sitter@0.20.8`에서 `pattern`, `0.27.0`에서 `patternIndex`다. 어댑터가 둘 다 읽는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// test/unit/php/tree-sitter-runtime.test.ts
import { strict as assert } from 'assert';
import { PhpRuntime } from '../../../src/infrastructure/php/tree-sitter-runtime';
import { ScopeTable } from '../../../src/infrastructure/php/scope-table';

describe('PhpRuntime', () => {
  let runtime: PhpRuntime;
  before(async () => { runtime = await PhpRuntime.create(); });

  it('패턴 인덱스로 매치를 구분한다', () => {
    const query = runtime.compile('(variable_name (name) @v)\n(string (string_content) @s)');
    const doc = runtime.parse('<?php $a = "x";')!;
    const indexes = [...doc.run(query, ScopeTable.of([], doc.endIndex))].map(m => m.patternIndex);
    assert.deepEqual([...new Set(indexes)].sort(), [0, 1]);
    doc.dispose();
  });

  it('캡처 텍스트와 위치를 준다', () => {
    const query = runtime.compile('(variable_name (name) @v)');
    const doc = runtime.parse('<?php\n$abc = 1;')!;
    const first = [...doc.run(query, ScopeTable.of([], doc.endIndex))][0];
    assert.equal(first.captures.text('v'), 'abc');
    assert.equal(first.captures.line('v'), 1);
    assert.equal(first.captures.column('v'), 1);
    doc.dispose();
  });

  it('파싱에 실패하면 null을 주고 다음 문서에 영향을 주지 않는다', () => {
    const broken = runtime.parse('<?php $a = "\\x41";');
    const next = runtime.parse('<?php $b = 1;');
    assert.ok(next !== null);
    if (broken) broken.dispose();
    next!.dispose();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx mocha test/unit/php/tree-sitter-runtime.test.ts`
Expected: FAIL — `Cannot find module '.../tree-sitter-runtime'`

- [ ] **Step 3: 구현한다**

```ts
// src/infrastructure/php/tree-sitter-runtime.ts
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
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx mocha test/unit/php/tree-sitter-runtime.test.ts`
Expected: PASS (3 passing)

- [ ] **Step 5: 커밋**

```bash
git add src/infrastructure/php/tree-sitter-runtime.ts test/unit/php/tree-sitter-runtime.test.ts
git commit -m "feat: tree-sitter 런타임 어댑터"
```

---

### Task 4: 조각 집합과 분기

**Files:**
- Create: `src/infrastructure/php/fragment-set.ts`
- Test: `test/unit/php/fragment-set.test.ts`

**Interfaces:**
- Consumes: `QueryFragment`, `FactKind`, `FactSink`, `topLevelPatternCount` (Task 1), `FragmentMatch` (Task 3)
- Produces: `FragmentSet.of(fragments: readonly QueryFragment[]): FragmentSet`, `set.source: string`, `set.collect(matches: Iterable<FragmentMatch>, into: FactSink, need?: ReadonlySet<FactKind>): void`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// test/unit/php/fragment-set.test.ts
import { strict as assert } from 'assert';
import { FragmentSet } from '../../../src/infrastructure/php/fragment-set';
import { Captures, FactKind, FactSink, QueryFragment } from '../../../src/infrastructure/php/query-fragment';

const stubCaptures: Captures = {
  has: () => true, text: () => 'x', index: () => 0, line: () => 0, column: () => 0,
  scope: () => ({ start: 0, end: 1 }), lastNameIn: () => null,
};

function fragment(produces: FactKind, pattern: string): QueryFragment {
  return {
    produces: [produces],
    pattern,
    collect: (_at, into) => into.add('tableRefs', { name: produces, nameLine: 0, nameColumn: 0, nameIndex: 0 }),
  };
}

function recordingSink(): { sink: FactSink; seen: string[] } {
  const seen: string[] = [];
  return { seen, sink: { add: (_kind, fact) => seen.push((fact as { name: string }).name) } };
}

describe('FragmentSet', () => {
  it('통합 소스는 조각 패턴을 순서대로 잇는다', () => {
    const set = FragmentSet.of([fragment('tableRefs', '(a) @x'), fragment('stringCalls', '(b) @y')]);
    assert.equal(set.source, '(a) @x\n(b) @y');
  });

  it('패턴 인덱스로 조각을 되찾는다', () => {
    const set = FragmentSet.of([fragment('tableRefs', '(a) @x'), fragment('stringCalls', '(b) @y')]);
    const { sink, seen } = recordingSink();
    set.collect([{ patternIndex: 1, captures: stubCaptures }], sink);
    assert.deepEqual(seen, ['stringCalls']);
  });

  it('need에 없는 조각은 건너뛴다', () => {
    const set = FragmentSet.of([fragment('tableRefs', '(a) @x'), fragment('stringCalls', '(b) @y')]);
    const { sink, seen } = recordingSink();
    set.collect(
      [{ patternIndex: 0, captures: stubCaptures }, { patternIndex: 1, captures: stubCaptures }],
      sink, new Set<FactKind>(['stringCalls']));
    assert.deepEqual(seen, ['stringCalls']);
  });

  it('최상위 패턴이 하나가 아닌 조각은 거부한다', () => {
    assert.throws(() => FragmentSet.of([fragment('tableRefs', '(a) @x\n(b) @y')]), /최상위 패턴/);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx mocha test/unit/php/fragment-set.test.ts`
Expected: FAIL — `Cannot find module '.../fragment-set'`

- [ ] **Step 3: 구현한다**

```ts
// src/infrastructure/php/fragment-set.ts
import { FragmentMatch } from './tree-sitter-runtime';
import { FactKind, FactSink, QueryFragment, topLevelPatternCount } from './query-fragment';

export class FragmentSet {
  private constructor(
    readonly source: string,
    private readonly fragments: readonly QueryFragment[],
  ) {}

  // 조각당 최상위 패턴이 하나여야 매치의 패턴 인덱스가 조각 배열 인덱스와 같아진다.
  static of(fragments: readonly QueryFragment[]): FragmentSet {
    fragments.forEach((f, i) => {
      const count = topLevelPatternCount(f.pattern);
      if (count !== 1) throw new Error(`조각 ${i}의 최상위 패턴이 ${count}개다 — 정확히 1개여야 한다`);
    });
    return new FragmentSet(fragments.map(f => f.pattern).join('\n'), fragments);
  }

  collect(matches: Iterable<FragmentMatch>, into: FactSink, need?: ReadonlySet<FactKind>): void {
    for (const match of matches) {
      const fragment = this.fragments[match.patternIndex];
      if (!fragment) continue;
      if (need && !fragment.produces.some(kind => need.has(kind))) continue;
      fragment.collect(match.captures, into);
    }
  }
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx mocha test/unit/php/fragment-set.test.ts`
Expected: PASS (4 passing)

- [ ] **Step 5: 커밋**

```bash
git add src/infrastructure/php/fragment-set.ts test/unit/php/fragment-set.test.ts
git commit -m "feat: 조각 집합과 패턴 인덱스 분기"
```

---

### Task 5: 레코드 조각

**Files:**
- Create: `src/infrastructure/php/fragments/record.ts`
- Test: `test/unit/php/fragments-record.test.ts`

**Interfaces:**
- Consumes: `QueryFragment` (Task 1)
- Produces: `recordFragments: readonly QueryFragment[]` — `assignments`(2) · `foreachBindings`(4) · `dataArgBindings`(1) · `plainAssignments`(1), 총 8개

`foreach`는 값 변수를 감싸는 노드가 형태마다 달라 네 패턴으로 나뉜다. key 변수는 레코드가 아니므로 패턴을 정확히 매칭시키기 위해 캡처만 하고 쓰지 않는다. `dataArg`는 테이블 문자열 바로 다음 위치 인자만 잡고, 쓰기 메서드가 아니면 `collect`에서 빠진다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// test/unit/php/fragments-record.test.ts
import { strict as assert } from 'assert';
import { recordFragments } from '../../../src/infrastructure/php/fragments/record';
import { FragmentSet } from '../../../src/infrastructure/php/fragment-set';
import { PhpRuntime } from '../../../src/infrastructure/php/tree-sitter-runtime';
import { ScopeTable } from '../../../src/infrastructure/php/scope-table';
import { DocumentFacts, emptyFacts } from '../../../src/domain/code-analysis/facts';

const CODE = `<?php
function f() {
  $rec = $DB->get_record('assign', ['id' => 1]);
  $rows = $DB->get_records('local_log', []);
  foreach ($rows as $r) { echo $r->id; }
  foreach ($rows as $k => &$v) { echo $v->id; }
  $DB->insert_record('local_cfg', $data);
  $rec = build();
}`;

async function factsOf(): Promise<DocumentFacts> {
  const runtime = await PhpRuntime.create();
  const set = FragmentSet.of(recordFragments);
  const query = runtime.compile(set.source);
  const doc = runtime.parse(CODE)!;
  const facts = emptyFacts();
  set.collect(doc.run(query, ScopeTable.of(doc.scopeRanges(), doc.endIndex)),
    { add: (kind, fact) => { (facts[kind] as unknown[]).push(fact); } });
  doc.dispose();
  return facts;
}

describe('recordFragments', () => {
  let f: DocumentFacts;
  before(async () => { f = await factsOf(); });

  it('테이블 인자가 있는 대입', () => {
    const a = f.assignments.find(x => x.varName === 'rec' && x.tableArg === 'assign')!;
    assert.equal(a.method, 'get_record');
    assert.equal(a.receiver, 'DB');
  });
  it('foreach 단순 형태', () => {
    const b = f.foreachBindings.find(x => x.itemVar === 'r')!;
    assert.equal(b.collectionVar, 'rows');
  });
  it('foreach key=>&value 형태의 값 변수만 담는다', () => {
    assert.ok(f.foreachBindings.some(x => x.itemVar === 'v'));
    assert.ok(!f.foreachBindings.some(x => x.itemVar === 'k'));
  });
  it('쓰기 메서드의 데이터 인자', () => {
    const d = f.dataArgBindings.find(x => x.dataVar === 'data')!;
    assert.equal(d.tableArg, 'local_cfg');
    assert.equal(d.method, 'insert_record');
  });
  it('일반 대입은 재대입 추적을 위해 모두 담는다', () => {
    assert.equal(f.plainAssignments.filter(x => x.varName === 'rec').length, 2);
  });
  it('함수 스코프가 문서 전체가 아니다', () => {
    const a = f.assignments.find(x => x.varName === 'rec')!;
    assert.ok(a.scope.start > 0);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx mocha test/unit/php/fragments-record.test.ts`
Expected: FAIL — `Cannot find module '.../fragments/record'`

- [ ] **Step 3: 구현한다**

```ts
// src/infrastructure/php/fragments/record.ts
import { QueryFragment } from '../query-fragment';

const WRITE_METHODS = new Set(['insert_record', 'update_record']);

const assignWithTable: QueryFragment = {
  produces: ['assignments'],
  pattern: `(assignment_expression
    left: (variable_name (name) @var)
    right: (member_call_expression
      object: (variable_name (name) @recv)
      name: (name) @method
      arguments: (arguments . (argument (string (string_content) @table)))))`,
  collect: (at, into) => into.add('assignments', {
    varName: at.text('var'), receiver: at.text('recv'), method: at.text('method'),
    tableArg: at.text('table'), index: at.index('var'), scope: at.scope('var'),
  }),
};

const assignWithoutTable: QueryFragment = {
  produces: ['assignments'],
  pattern: `(assignment_expression
    left: (variable_name (name) @var)
    right: (member_call_expression
      object: (variable_name (name) @recv)
      name: (name) @method))`,
  collect: (at, into) => into.add('assignments', {
    varName: at.text('var'), receiver: at.text('recv'), method: at.text('method'),
    tableArg: null, index: at.index('var'), scope: at.scope('var'),
  }),
};

function foreachFragment(pattern: string): QueryFragment {
  return {
    produces: ['foreachBindings'],
    pattern,
    collect: (at, into) => into.add('foreachBindings', {
      collectionVar: at.text('collection'), itemVar: at.text('item'),
      index: at.index('item'), scope: at.scope('item'),
    }),
  };
}

const dataArg: QueryFragment = {
  produces: ['dataArgBindings'],
  pattern: `(member_call_expression
    name: (name) @method
    arguments: (arguments . (argument (string (string_content) @table)) . (argument (variable_name (name) @datavar))))`,
  collect: (at, into) => {
    const method = at.text('method');
    if (!WRITE_METHODS.has(method)) return;
    into.add('dataArgBindings', {
      method, tableArg: at.text('table'), dataVar: at.text('datavar'),
      index: at.index('datavar'), scope: at.scope('datavar'),
    });
  },
};

const plainAssign: QueryFragment = {
  produces: ['plainAssignments'],
  pattern: '(assignment_expression left: (variable_name (name) @var))',
  collect: (at, into) => into.add('plainAssignments', {
    varName: at.text('var'), index: at.index('var'), scope: at.scope('var'),
  }),
};

export const recordFragments: readonly QueryFragment[] = [
  assignWithTable,
  assignWithoutTable,
  foreachFragment('(foreach_statement (variable_name (name) @collection) (variable_name (name) @item))'),
  foreachFragment(`(foreach_statement (variable_name (name) @collection)
    (pair (variable_name (name) @key) (variable_name (name) @item)))`),
  foreachFragment(`(foreach_statement (variable_name (name) @collection)
    (by_ref (variable_name (name) @item)))`),
  foreachFragment(`(foreach_statement (variable_name (name) @collection)
    (pair (variable_name (name) @key) (by_ref (variable_name (name) @item))))`),
  dataArg,
  plainAssign,
];
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx mocha test/unit/php/fragments-record.test.ts`
Expected: PASS (6 passing)

- [ ] **Step 5: 커밋**

```bash
git add src/infrastructure/php/fragments/record.ts test/unit/php/fragments-record.test.ts
git commit -m "feat: 레코드 조각"
```

---

### Task 6: 접근·phpdoc 조각

**Files:**
- Create: `src/infrastructure/php/fragments/access.ts`
- Test: `test/unit/php/fragments-access.test.ts`

**Interfaces:**
- Consumes: `QueryFragment` (Task 1)
- Produces: `accessFragments: readonly QueryFragment[]` — `propertyAccesses`(1) · `methodCalls`(1) · `phpdocVars`(1), 총 3개

`phpdocVars`는 `(comment) @c` 패턴으로 주석 노드만 잡고 그 텍스트에 정규식을 돌린다. 팩트의 `index`는 매치 위치가 아니라 **주석 노드의 시작**이다 — 현행과 같은 값이어야 `record-type-inference`의 위치 비교가 달라지지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// test/unit/php/fragments-access.test.ts
import { strict as assert } from 'assert';
import { accessFragments } from '../../../src/infrastructure/php/fragments/access';
import { FragmentSet } from '../../../src/infrastructure/php/fragment-set';
import { PhpRuntime } from '../../../src/infrastructure/php/tree-sitter-runtime';
import { ScopeTable } from '../../../src/infrastructure/php/scope-table';
import { DocumentFacts, emptyFacts } from '../../../src/domain/code-analysis/facts';

const CODE = `<?php
/** @var local_x_table $rec */
$rec = null;
echo $rec->userid;
$DB->get_record('user', []);
$note = "@var fake_table $ghost";
`;

async function factsOf(): Promise<DocumentFacts> {
  const runtime = await PhpRuntime.create();
  const set = FragmentSet.of(accessFragments);
  const query = runtime.compile(set.source);
  const doc = runtime.parse(CODE)!;
  const facts = emptyFacts();
  set.collect(doc.run(query, ScopeTable.of(doc.scopeRanges(), doc.endIndex)),
    { add: (kind, fact) => { (facts[kind] as unknown[]).push(fact); } });
  doc.dispose();
  return facts;
}

describe('accessFragments', () => {
  let f: DocumentFacts;
  before(async () => { f = await factsOf(); });

  it('프로퍼티 접근의 이름 위치를 담는다', () => {
    const p = f.propertyAccesses.find(x => x.varName === 'rec' && x.property === 'userid')!;
    assert.equal(p.propLine, 3);
    assert.ok(p.propIndex > p.index);
  });
  it('메서드 호출을 담는다', () => {
    assert.ok(f.methodCalls.some(x => x.varName === 'DB' && x.method === 'get_record'));
  });
  it('주석의 @var를 담는다', () => {
    const v = f.phpdocVars.find(x => x.varName === 'rec')!;
    assert.equal(v.typeText, 'local_x_table');
  });
  it('주석 밖 문자열의 @var는 담지 않는다', () => {
    assert.ok(!f.phpdocVars.some(x => x.varName === 'ghost'));
  });
  it('@var의 index는 주석 노드의 시작이다', () => {
    const v = f.phpdocVars.find(x => x.varName === 'rec')!;
    assert.equal(CODE.slice(v.index, v.index + 3), '/**');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx mocha test/unit/php/fragments-access.test.ts`
Expected: FAIL — `Cannot find module '.../fragments/access'`

- [ ] **Step 3: 구현한다**

```ts
// src/infrastructure/php/fragments/access.ts
import { QueryFragment } from '../query-fragment';

const PHPDOC_VAR = /@var\s+([^\s]+)\s+\$(\w+)/g;

const propertyAccess: QueryFragment = {
  produces: ['propertyAccesses'],
  pattern: '(member_access_expression object: (variable_name (name) @var) name: (name) @prop)',
  collect: (at, into) => into.add('propertyAccesses', {
    varName: at.text('var'), property: at.text('prop'),
    propLine: at.line('prop'), propColumn: at.column('prop'), propIndex: at.index('prop'),
    index: at.index('var'), scope: at.scope('var'),
  }),
};

const methodCall: QueryFragment = {
  produces: ['methodCalls'],
  pattern: '(member_call_expression object: (variable_name (name) @var) name: (name) @method)',
  collect: (at, into) => into.add('methodCalls', {
    varName: at.text('var'), method: at.text('method'),
    nameLine: at.line('method'), nameColumn: at.column('method'), nameIndex: at.index('method'),
    index: at.index('var'), scope: at.scope('var'),
  }),
};

// 트리시터가 phpdoc 내부를 파싱하지 않으므로 주석 노드 텍스트에 정규식을 돌린다.
const phpdocVars: QueryFragment = {
  produces: ['phpdocVars'],
  pattern: '(comment) @c',
  collect: (at, into) => {
    const index = at.index('c');
    const scope = at.scope('c');
    const text = at.text('c');
    PHPDOC_VAR.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PHPDOC_VAR.exec(text))) {
      into.add('phpdocVars', { typeText: m[1], varName: m[2], index, scope });
    }
  },
};

export const accessFragments: readonly QueryFragment[] = [propertyAccess, methodCall, phpdocVars];
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx mocha test/unit/php/fragments-access.test.ts`
Expected: PASS (5 passing)

- [ ] **Step 5: 커밋**

```bash
git add src/infrastructure/php/fragments/access.ts test/unit/php/fragments-access.test.ts
git commit -m "feat: 접근·phpdoc 조각"
```

---

### Task 7: 문자열 조각

**Files:**
- Create: `src/infrastructure/php/fragments/strings.ts`
- Test: `test/unit/php/fragments-strings.test.ts`

**Interfaces:**
- Consumes: `QueryFragment` (Task 1), `stringFunctionForm`·`stringClassForm`·`effectiveComponent`·`StringCallForm` (`src/domain/code-analysis/string-functions.ts`)
- Produces: `stringFragments: readonly QueryFragment[]` — `stringCalls`(4) · `dynamicStringCalls`(3) · `literalAssignments`(1) · `propertyLiterals`(1) · `constLiterals`(1), 총 10개
- Produces: `componentRefOf(at: Captures): ComponentRef | null` — 설정 조각(Task 8)이 같은 세 형태를 쓴다

`$this`가 아닌 객체의 프로퍼티는 이 파일에서 정의를 알 수 없으므로 담지 않는다. `X::NAME`은 `name` 노드가 둘이라 마지막을 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// test/unit/php/fragments-strings.test.ts
import { strict as assert } from 'assert';
import { stringFragments } from '../../../src/infrastructure/php/fragments/strings';
import { FragmentSet } from '../../../src/infrastructure/php/fragment-set';
import { PhpRuntime } from '../../../src/infrastructure/php/tree-sitter-runtime';
import { ScopeTable } from '../../../src/infrastructure/php/scope-table';
import { DocumentFacts, emptyFacts } from '../../../src/domain/code-analysis/facts';

const CODE = `<?php
class C {
  public $comp = 'local_x';
  const NAME = 'local_y';
  function f($other) {
    echo get_string('a', 'local_x');
    echo get_string('bare');
    throw new moodle_exception('code');
    echo get_string('k1', $var);
    echo get_string('k2', $this->comp);
    echo get_string('k3', self::NAME);
    echo get_string('k4', $other->comp);
    $v = 'literal';
  }
}`;

async function factsOf(): Promise<DocumentFacts> {
  const runtime = await PhpRuntime.create();
  const set = FragmentSet.of(stringFragments);
  const query = runtime.compile(set.source);
  const doc = runtime.parse(CODE)!;
  const facts = emptyFacts();
  set.collect(doc.run(query, ScopeTable.of(doc.scopeRanges(), doc.endIndex)),
    { add: (kind, fact) => { (facts[kind] as unknown[]).push(fact); } });
  doc.dispose();
  return facts;
}

describe('stringFragments', () => {
  let f: DocumentFacts;
  before(async () => { f = await factsOf(); });

  it('리터럴 컴포넌트', () => {
    assert.equal(f.stringCalls.find(c => c.key === 'a')!.component, 'local_x');
  });
  it('컴포넌트 생략은 형태별 기본값', () => {
    assert.equal(f.stringCalls.find(c => c.key === 'bare')!.component, 'core');
    assert.equal(f.stringCalls.find(c => c.key === 'code')!.component, 'error');
  });
  it('동적 컴포넌트 세 형태', () => {
    assert.deepEqual(f.dynamicStringCalls.find(c => c.key === 'k1')!.comp, { kind: 'var', name: 'var' });
    assert.deepEqual(f.dynamicStringCalls.find(c => c.key === 'k2')!.comp, { kind: 'prop', name: 'comp' });
    assert.deepEqual(f.dynamicStringCalls.find(c => c.key === 'k3')!.comp, { kind: 'const', name: 'NAME' });
  });
  it('$this가 아닌 수신자의 프로퍼티는 담지 않는다', () => {
    assert.ok(!f.dynamicStringCalls.some(c => c.key === 'k4'));
  });
  it('리터럴 출처 세 종류', () => {
    assert.ok(f.literalAssignments.some(a => a.varName === 'v' && a.value === 'literal'));
    assert.ok(f.propertyLiterals.some(p => p.property === 'comp' && p.value === 'local_x'));
    assert.ok(f.constLiterals.some(c => c.name === 'NAME' && c.value === 'local_y'));
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx mocha test/unit/php/fragments-strings.test.ts`
Expected: FAIL — `Cannot find module '.../fragments/strings'`

- [ ] **Step 3: 구현한다**

```ts
// src/infrastructure/php/fragments/strings.ts
import { ComponentRef } from '../../../domain/code-analysis/facts';
import { StringCallForm, effectiveComponent, stringClassForm, stringFunctionForm } from '../../../domain/code-analysis/string-functions';
import { Captures, QueryFragment } from '../query-fragment';

export const DYNAMIC_COMPONENT_ARG =
  '[(variable_name (name) @dynvar) (member_access_expression object: (variable_name) @dynrecv name: (name) @dynprop) (class_constant_access_expression) @dynconst]';

export function componentRefOf(at: Captures): ComponentRef | null {
  if (at.has('dynvar')) return { kind: 'var', name: at.text('dynvar') };
  if (at.has('dynprop')) {
    if (at.text('dynrecv') !== '$this') return null;
    return { kind: 'prop', name: at.text('dynprop') };
  }
  if (at.has('dynconst')) {
    const name = at.lastNameIn('dynconst');
    return name ? { kind: 'const', name } : null;
  }
  return null;
}

function literalCall(pattern: string, formOf: (name: string) => StringCallForm | undefined,
                     nameCapture: string, hasComponent: boolean): QueryFragment {
  return {
    produces: ['stringCalls'],
    pattern,
    collect: (at, into) => {
      const form = formOf(at.text(nameCapture));
      if (!form) return;
      into.add('stringCalls', {
        key: at.text('key'),
        component: effectiveComponent(form, hasComponent ? at.text('component') : ''),
        keyLine: at.line('key'), keyColumn: at.column('key'), keyIndex: at.index('key'),
        index: at.index(nameCapture),
      });
    },
  };
}

function dynamicCall(pattern: string): QueryFragment {
  return {
    produces: ['dynamicStringCalls'],
    pattern,
    collect: (at, into) => {
      if (!stringFunctionForm(at.text('fn'))) return;
      const comp = componentRefOf(at);
      if (!comp) return;
      into.add('dynamicStringCalls', {
        key: at.text('key'), comp,
        keyLine: at.line('key'), keyColumn: at.column('key'), keyIndex: at.index('key'),
        index: at.index('fn'), scope: at.scope('fn'),
      });
    },
  };
}

const literalAssignment: QueryFragment = {
  produces: ['literalAssignments'],
  pattern: '(assignment_expression left: (variable_name (name) @var) right: (string (string_content) @val))',
  collect: (at, into) => into.add('literalAssignments', {
    varName: at.text('var'), value: at.text('val'), index: at.index('var'), scope: at.scope('var'),
  }),
};

const propertyLiteral: QueryFragment = {
  produces: ['propertyLiterals'],
  pattern: `(property_declaration (property_element (variable_name (name) @prop)
    (property_initializer (string (string_content) @value))))`,
  collect: (at, into) => into.add('propertyLiterals', {
    property: at.text('prop'), value: at.text('value'), index: at.index('prop'),
  }),
};

const constLiteral: QueryFragment = {
  produces: ['constLiterals'],
  pattern: '(const_declaration (const_element (name) @cname (string (string_content) @cval)))',
  collect: (at, into) => into.add('constLiterals', {
    name: at.text('cname'), value: at.text('cval'), index: at.index('cname'),
  }),
};

export const stringFragments: readonly QueryFragment[] = [
  literalCall(`(function_call_expression
    function: (name) @fn
    arguments: (arguments
      . (argument (string (string_content) @key))
      . (argument (string (string_content) @component))))`, stringFunctionForm, 'fn', true),
  literalCall(`(function_call_expression
    function: (name) @fn
    arguments: (arguments . (argument (string (string_content) @key)) .))`, stringFunctionForm, 'fn', false),
  literalCall(`(object_creation_expression
    [(name) @cls (qualified_name (name) @cls)]
    (arguments
      . (argument (string (string_content) @key))
      . (argument (string (string_content) @component))))`, stringClassForm, 'cls', true),
  literalCall(`(object_creation_expression
    [(name) @cls (qualified_name (name) @cls)]
    (arguments . (argument (string (string_content) @key)) .))`, stringClassForm, 'cls', false),
  dynamicCall(`(function_call_expression function: (name) @fn arguments: (arguments
    . (argument (string (string_content) @key)) . (argument (variable_name (name) @dynvar))))`),
  dynamicCall(`(function_call_expression function: (name) @fn arguments: (arguments
    . (argument (string (string_content) @key))
    . (argument (member_access_expression object: (variable_name) @dynrecv name: (name) @dynprop))))`),
  dynamicCall(`(function_call_expression function: (name) @fn arguments: (arguments
    . (argument (string (string_content) @key)) . (argument (class_constant_access_expression) @dynconst)))`),
  literalAssignment,
  propertyLiteral,
  constLiteral,
];
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx mocha test/unit/php/fragments-strings.test.ts`
Expected: PASS (5 passing)

- [ ] **Step 5: 커밋**

```bash
git add src/infrastructure/php/fragments/strings.ts test/unit/php/fragments-strings.test.ts
git commit -m "feat: 문자열 조각"
```

---

### Task 8: 설정 조각

**Files:**
- Create: `src/infrastructure/php/fragments/config.ts`
- Test: `test/unit/php/fragments-config.test.ts`

**Interfaces:**
- Consumes: `QueryFragment` (Task 1), `componentRefOf`·`DYNAMIC_COMPONENT_ARG` (Task 7), `configFunctionKind` (`src/domain/code-analysis/config-functions.ts`)
- Produces: `configFragments: readonly QueryFragment[]` — `configCalls`(2) · `dynamicConfigCalls`(2), 총 4개

`get_config(plugin, key)`와 `set_config(key, value, plugin)`은 인자 자리가 다르다. 플러그인 이름은 정규화하지 않고 저장 키 그대로 담는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// test/unit/php/fragments-config.test.ts
import { strict as assert } from 'assert';
import { configFragments } from '../../../src/infrastructure/php/fragments/config';
import { FragmentSet } from '../../../src/infrastructure/php/fragment-set';
import { PhpRuntime } from '../../../src/infrastructure/php/tree-sitter-runtime';
import { ScopeTable } from '../../../src/infrastructure/php/scope-table';
import { DocumentFacts, emptyFacts } from '../../../src/domain/code-analysis/facts';

const CODE = `<?php
class C {
  function f($p) {
    echo get_config('local_x', 'key1');
    set_config('key2', 1, 'local_y');
    echo get_config($p, 'key3');
    set_config('key4', 1, $this->plugin);
  }
}`;

async function factsOf(): Promise<DocumentFacts> {
  const runtime = await PhpRuntime.create();
  const set = FragmentSet.of(configFragments);
  const query = runtime.compile(set.source);
  const doc = runtime.parse(CODE)!;
  const facts = emptyFacts();
  set.collect(doc.run(query, ScopeTable.of(doc.scopeRanges(), doc.endIndex)),
    { add: (kind, fact) => { (facts[kind] as unknown[]).push(fact); } });
  doc.dispose();
  return facts;
}

describe('configFragments', () => {
  let f: DocumentFacts;
  before(async () => { f = await factsOf(); });

  it('get_config는 첫 인자가 플러그인', () => {
    const c = f.configCalls.find(x => x.key === 'key1')!;
    assert.equal(c.plugin, 'local_x');
    assert.equal(c.kind, 'get');
  });
  it('set_config는 셋째 인자가 플러그인', () => {
    const c = f.configCalls.find(x => x.key === 'key2')!;
    assert.equal(c.plugin, 'local_y');
    assert.equal(c.kind, 'set');
  });
  it('동적 플러그인은 형태만 담는다', () => {
    assert.deepEqual(f.dynamicConfigCalls.find(x => x.key === 'key3')!.comp, { kind: 'var', name: 'p' });
    assert.deepEqual(f.dynamicConfigCalls.find(x => x.key === 'key4')!.comp, { kind: 'prop', name: 'plugin' });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx mocha test/unit/php/fragments-config.test.ts`
Expected: FAIL — `Cannot find module '.../fragments/config'`

- [ ] **Step 3: 구현한다**

```ts
// src/infrastructure/php/fragments/config.ts
import { configFunctionKind } from '../../../domain/code-analysis/config-functions';
import { QueryFragment } from '../query-fragment';
import { DYNAMIC_COMPONENT_ARG, componentRefOf } from './strings';

function literalConfig(pattern: string, kind: 'get' | 'set'): QueryFragment {
  return {
    produces: ['configCalls'],
    pattern,
    collect: (at, into) => {
      if (configFunctionKind(at.text('fn')) !== kind) return;
      into.add('configCalls', {
        plugin: at.text('plugin'), key: at.text('key'), kind,
        keyLine: at.line('key'), keyColumn: at.column('key'), keyIndex: at.index('key'),
        index: at.index('fn'),
      });
    },
  };
}

function dynamicConfig(pattern: string, kind: 'get' | 'set'): QueryFragment {
  return {
    produces: ['dynamicConfigCalls'],
    pattern,
    collect: (at, into) => {
      if (configFunctionKind(at.text('fn')) !== kind) return;
      const comp = componentRefOf(at);
      if (!comp) return;
      into.add('dynamicConfigCalls', {
        key: at.text('key'), comp, kind,
        keyLine: at.line('key'), keyColumn: at.column('key'), keyIndex: at.index('key'),
        index: at.index('fn'), scope: at.scope('fn'),
      });
    },
  };
}

export const configFragments: readonly QueryFragment[] = [
  literalConfig(`(function_call_expression function: (name) @fn arguments: (arguments
    . (argument (string (string_content) @plugin)) . (argument (string (string_content) @key))))`, 'get'),
  literalConfig(`(function_call_expression function: (name) @fn arguments: (arguments
    . (argument (string (string_content) @key)) . (argument) . (argument (string (string_content) @plugin))))`, 'set'),
  dynamicConfig(`(function_call_expression function: (name) @fn arguments: (arguments
    . (argument ${DYNAMIC_COMPONENT_ARG}) . (argument (string (string_content) @key))))`, 'get'),
  dynamicConfig(`(function_call_expression function: (name) @fn arguments: (arguments
    . (argument (string (string_content) @key)) . (argument) . (argument ${DYNAMIC_COMPONENT_ARG})))`, 'set'),
];
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx mocha test/unit/php/fragments-config.test.ts`
Expected: PASS (3 passing)

- [ ] **Step 5: 커밋**

```bash
git add src/infrastructure/php/fragments/config.ts test/unit/php/fragments-config.test.ts
git commit -m "feat: 설정 조각"
```

---

### Task 9: 테이블 조각

**Files:**
- Create: `src/infrastructure/php/fragments/tables.ts`
- Test: `test/unit/php/fragments-tables.test.ts`

**Interfaces:**
- Consumes: `QueryFragment` (Task 1)
- Produces: `tableFragments: readonly QueryFragment[]` — `tableRefs`(3): 문자열 본문·nowdoc 본문·`$DB` 첫 인자

`string_content` 하나가 단일 인용·이중 인용·heredoc을 모두 덮고 nowdoc만 별도 타입이라 조각이 둘로 나뉜다. 이중 인용의 `{$var}` 보간은 별도 노드로 쪼개져 문자열 내용에 남지 않는다. 줄·컬럼은 노드를 한 번만 훑으며 누적한다 — 매치마다 앞을 되짚으면 매치 수에 대해 제곱이 된다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// test/unit/php/fragments-tables.test.ts
import { strict as assert } from 'assert';
import { tableFragments } from '../../../src/infrastructure/php/fragments/tables';
import { FragmentSet } from '../../../src/infrastructure/php/fragment-set';
import { PhpRuntime } from '../../../src/infrastructure/php/tree-sitter-runtime';
import { ScopeTable } from '../../../src/infrastructure/php/scope-table';
import { DocumentFacts, emptyFacts } from '../../../src/domain/code-analysis/facts';

const CODE = `<?php
$sql = "SELECT *
  FROM {local_a} a
  JOIN {local_b} b ON a.id = b.aid";
$DB->update_record('local_c', $x);
$DB->sql_like('col', '?');
`;

async function factsOf(): Promise<DocumentFacts> {
  const runtime = await PhpRuntime.create();
  const set = FragmentSet.of(tableFragments);
  const query = runtime.compile(set.source);
  const doc = runtime.parse(CODE)!;
  const facts = emptyFacts();
  set.collect(doc.run(query, ScopeTable.of(doc.scopeRanges(), doc.endIndex)),
    { add: (kind, fact) => { (facts[kind] as unknown[]).push(fact); } });
  doc.dispose();
  return facts;
}

describe('tableFragments', () => {
  let f: DocumentFacts;
  before(async () => { f = await factsOf(); });

  it('SQL 중괄호 참조를 담는다', () => {
    assert.deepEqual(f.tableRefs.filter(r => r.name.startsWith('local_')).map(r => r.name).sort(),
      ['local_a', 'local_b', 'local_c']);
  });
  it('여러 줄 문자열에서 줄·컬럼이 문서 기준이다', () => {
    const b = f.tableRefs.find(r => r.name === 'local_b')!;
    assert.equal(b.nameLine, 3);
    assert.equal(CODE.slice(b.nameIndex, b.nameIndex + 7), 'local_b');
  });
  it('sql_ 접두 메서드의 첫 인자는 테이블이 아니다', () => {
    assert.ok(!f.tableRefs.some(r => r.name === 'col'));
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx mocha test/unit/php/fragments-tables.test.ts`
Expected: FAIL — `Cannot find module '.../fragments/tables'`

- [ ] **Step 3: 구현한다**

```ts
// src/infrastructure/php/fragments/tables.ts
import { Captures, FactSink, QueryFragment } from '../query-fragment';

const BRACED_NAME = /\{(\w+)\}/g;
const SQL_HELPER_PREFIX = 'sql_';

function collectBracedNames(at: Captures, into: FactSink, capture: string): void {
  const body = at.text(capture);
  if (!body.includes('{')) return;
  const start = at.index(capture);
  let line = at.line(capture);
  let lineStart = -at.column(capture);
  let scanned = 0;
  BRACED_NAME.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BRACED_NAME.exec(body))) {
    const nameOffset = m.index + 1;
    for (; scanned < nameOffset; scanned++) {
      if (body[scanned] === '\n') { line++; lineStart = scanned + 1; }
    }
    into.add('tableRefs', {
      name: m[1], nameLine: line, nameColumn: nameOffset - lineStart, nameIndex: start + nameOffset,
    });
  }
}

function bracedNamesIn(pattern: string, capture: string): QueryFragment {
  return {
    produces: ['tableRefs'],
    pattern,
    collect: (at, into) => collectBracedNames(at, into, capture),
  };
}

const dbFirstArgument: QueryFragment = {
  produces: ['tableRefs'],
  pattern: `(member_call_expression
    object: (variable_name (name) @recv)
    name: (name) @method
    arguments: (arguments . (argument (string (string_content) @table))))`,
  collect: (at, into) => {
    if (at.text('recv') !== 'DB') return;
    if (at.text('method').startsWith(SQL_HELPER_PREFIX)) return;
    into.add('tableRefs', {
      name: at.text('table'),
      nameLine: at.line('table'), nameColumn: at.column('table'), nameIndex: at.index('table'),
    });
  },
};

export const tableFragments: readonly QueryFragment[] = [
  bracedNamesIn('(string_content) @s', 's'),
  bracedNamesIn('(nowdoc_string) @n', 'n'),
  dbFirstArgument,
];
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx mocha test/unit/php/fragments-tables.test.ts`
Expected: PASS (3 passing)

- [ ] **Step 5: 커밋**

```bash
git add src/infrastructure/php/fragments/tables.ts test/unit/php/fragments-tables.test.ts
git commit -m "feat: 테이블 조각"
```

---

### Task 10: 템플릿·AMD 조각

**Files:**
- Create: `src/infrastructure/php/fragments/templates.ts`
- Test: `test/unit/php/fragments-templates.test.ts`

**Interfaces:**
- Consumes: `QueryFragment` (Task 1)
- Produces: `templateFragments: readonly QueryFragment[]` — `templateCalls`·`amdCalls`를 함께 내는 조각 1개

수신자를 제약하지 않아 `$OUTPUT->render_from_template`과 `$PAGE->requires->js_call_amd`를 함께 잡고, 종류는 메서드 이름으로 가른다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// test/unit/php/fragments-templates.test.ts
import { strict as assert } from 'assert';
import { templateFragments } from '../../../src/infrastructure/php/fragments/templates';
import { FragmentSet } from '../../../src/infrastructure/php/fragment-set';
import { PhpRuntime } from '../../../src/infrastructure/php/tree-sitter-runtime';
import { ScopeTable } from '../../../src/infrastructure/php/scope-table';
import { DocumentFacts, emptyFacts } from '../../../src/domain/code-analysis/facts';

const CODE = `<?php
echo $OUTPUT->render_from_template('local_x/card', $ctx);
$PAGE->requires->js_call_amd('local_x/view', 'init');
$DB->get_record('user', []);
`;

async function factsOf(): Promise<DocumentFacts> {
  const runtime = await PhpRuntime.create();
  const set = FragmentSet.of(templateFragments);
  const query = runtime.compile(set.source);
  const doc = runtime.parse(CODE)!;
  const facts = emptyFacts();
  set.collect(doc.run(query, ScopeTable.of(doc.scopeRanges(), doc.endIndex)),
    { add: (kind, fact) => { (facts[kind] as unknown[]).push(fact); } });
  doc.dispose();
  return facts;
}

describe('templateFragments', () => {
  let f: DocumentFacts;
  before(async () => { f = await factsOf(); });

  it('템플릿 참조', () => {
    assert.equal(f.templateCalls[0].ref, 'local_x/card');
  });
  it('AMD 참조', () => {
    assert.equal(f.amdCalls[0].ref, 'local_x/view');
  });
  it('관심 없는 메서드는 담지 않는다', () => {
    assert.equal(f.templateCalls.length + f.amdCalls.length, 2);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx mocha test/unit/php/fragments-templates.test.ts`
Expected: FAIL — `Cannot find module '.../fragments/templates'`

- [ ] **Step 3: 구현한다**

```ts
// src/infrastructure/php/fragments/templates.ts
import { QueryFragment } from '../query-fragment';

const TEMPLATE_METHOD = 'render_from_template';
const AMD_METHOD = 'js_call_amd';

const firstStringArgument: QueryFragment = {
  produces: ['templateCalls', 'amdCalls'],
  pattern: `(member_call_expression
    name: (name) @method
    arguments: (arguments . (argument (string (string_content) @ref))))`,
  collect: (at, into) => {
    const method = at.text('method');
    if (method !== TEMPLATE_METHOD && method !== AMD_METHOD) return;
    const call = {
      ref: at.text('ref'),
      refLine: at.line('ref'), refColumn: at.column('ref'), refIndex: at.index('ref'),
      index: at.index('method'),
    };
    into.add(method === TEMPLATE_METHOD ? 'templateCalls' : 'amdCalls', call);
  },
};

export const templateFragments: readonly QueryFragment[] = [firstStringArgument];
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx mocha test/unit/php/fragments-templates.test.ts`
Expected: PASS (3 passing)

- [ ] **Step 5: 커밋**

```bash
git add src/infrastructure/php/fragments/templates.ts test/unit/php/fragments-templates.test.ts
git commit -m "feat: 템플릿·AMD 조각"
```

---

### Task 11: 클래스 멤버 읽기

**Files:**
- Create: `src/infrastructure/php/class-members.ts`
- Test: `test/unit/php/class-members.test.ts`

**Interfaces:**
- Consumes: `ClassBodyReader` (Task 3), `RawClassMember` (`src/domain/code-analysis/ports/php-syntax.ts`)
- Produces: `readClassMembers(body: ClassBodyReader): RawClassMember[]`

`magic_get_<name>`은 Moodle의 매직 프로퍼티 관례라 protected여도 프로퍼티 `<name>`으로 바꿔 담는다 — 그러지 않으면 `$PAGE->context`가 빠진다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// test/unit/php/class-members.test.ts
import { strict as assert } from 'assert';
import { readClassMembers } from '../../../src/infrastructure/php/class-members';
import { PhpRuntime } from '../../../src/infrastructure/php/tree-sitter-runtime';

const CODE = `<?php
class moodle_page {
  /** 페이지 컨텍스트. 자세한 설명. */
  protected function magic_get_context() {}
  public $bodyid;
  private $hidden;
  private function secret() {}
  /** 레코드를 읽는다. */
  public function get_record($table, $conditions) {}
}`;

describe('readClassMembers', () => {
  let members: ReturnType<typeof readClassMembers>;
  before(async () => {
    const runtime = await PhpRuntime.create();
    const doc = runtime.parse(CODE)!;
    members = readClassMembers(doc.classBody('moodle_page')!);
    doc.dispose();
  });

  it('public 메서드는 시그니처와 첫 문장을 담는다', () => {
    const m = members.find(x => x.name === 'get_record')!;
    assert.equal(m.kind, 'method');
    assert.equal(m.signature, '($table, $conditions)');
    assert.equal(m.doc, '레코드를 읽는다.');
  });
  it('public 프로퍼티를 담는다', () => {
    assert.equal(members.find(x => x.name === 'bodyid')!.kind, 'property');
  });
  it('magic_get_은 프로퍼티로 바꿔 담는다', () => {
    assert.equal(members.find(x => x.name === 'context')!.kind, 'property');
  });
  it('private 멤버는 담지 않는다', () => {
    assert.ok(!members.some(x => x.name === 'hidden' || x.name === 'secret'));
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx mocha test/unit/php/class-members.test.ts`
Expected: FAIL — `Cannot find module '.../class-members'`

- [ ] **Step 3: 구현한다**

`src/infrastructure/tree-sitter/tree-sitter-php-syntax.ts`의 `readMember`·`childOfType`·`firstDescendantOfType`·`docBefore`를 그대로 옮기고, 진입점만 `ClassBodyReader`를 받게 한다.

```ts
// src/infrastructure/php/class-members.ts
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
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx mocha test/unit/php/class-members.test.ts`
Expected: PASS (4 passing)

- [ ] **Step 5: 커밋**

```bash
git add src/infrastructure/php/class-members.ts test/unit/php/class-members.test.ts
git commit -m "feat: 클래스 멤버 읽기 분리"
```

---

### Task 12: PhpSyntax 조립

**Files:**
- Create: `src/infrastructure/php/php-syntax.ts`
- Test: `test/unit/php/php-syntax.test.ts`

**Interfaces:**
- Consumes: Task 3~11의 전부
- Produces:
  - `TreeSitterPhpSyntax.create(runtimeDir?: string): Promise<TreeSitterPhpSyntax>`
  - `syntax.facts(text: string, need?: ReadonlySet<FactKind>): DocumentFacts`
  - `syntax.classMembers(text: string, className: string): RawClassMember[]`
  - `MAX_DOCUMENT_BYTES = 1_048_576`
  - `ALL_FRAGMENTS: readonly QueryFragment[]` — Task 14가 같은 목록을 검사하도록 export 한다

**정규화가 필요한 두 곳** — 통합 쿼리는 매치를 조각별이 아니라 문서 순서로 주므로, 현행이 "먼저 돈 쿼리 결과를 우선"으로 처리하던 두 자리를 명시적 정규화로 옮긴다.

- `assignments`: 같은 `index`에 테이블 있는 항목과 없는 항목이 함께 오면 **있는 쪽만** 남긴다.
- `foreachBindings`: 같은 `index`가 둘 이상이면 하나만 남긴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// test/unit/php/php-syntax.test.ts
import { strict as assert } from 'assert';
import { MAX_DOCUMENT_BYTES, TreeSitterPhpSyntax } from '../../../src/infrastructure/php/php-syntax';

const CODE = `<?php
function f() {
  $rec = $DB->get_record('assign', ['id' => 1]);
  $plain = $DB->get_record_sql($sql);
  $rows = $DB->get_records('local_log', []);
  foreach ($rows as $r) { echo $r->id; }
  echo get_string('key', 'local_x');
}`;

describe('TreeSitterPhpSyntax', () => {
  let syntax: TreeSitterPhpSyntax;
  before(async () => { syntax = await TreeSitterPhpSyntax.create(); });

  it('테이블 있는 대입이 없는 대입을 이긴다', () => {
    const found = syntax.facts(CODE).assignments.filter(a => a.varName === 'rec');
    assert.equal(found.length, 1);
    assert.equal(found[0].tableArg, 'assign');
  });
  it('테이블 인자가 없는 대입도 담는다', () => {
    const found = syntax.facts(CODE).assignments.find(a => a.varName === 'plain')!;
    assert.equal(found.tableArg, null);
    assert.equal(found.method, 'get_record_sql');
  });

  it('foreach 바인딩은 위치당 하나다', () => {
    assert.equal(syntax.facts(CODE).foreachBindings.filter(b => b.itemVar === 'r').length, 1);
  });
  it('need에 없는 팩트는 만들지 않는다', () => {
    const f = syntax.facts(CODE, new Set(['stringCalls'] as const));
    assert.equal(f.stringCalls.length, 1);
    assert.equal(f.assignments.length, 0);
  });
  it('16진 이스케이프가 있어도 다음 문서가 멀쩡하다', () => {
    syntax.facts('<?php $a = "\\x41";');
    assert.equal(syntax.facts(CODE).stringCalls.length, 1);
  });
  it('상한을 넘는 문서는 팩트가 없다', () => {
    const huge = `<?php $x = 1; ${'// filler\n'.repeat(MAX_DOCUMENT_BYTES / 10)}`;
    assert.equal(syntax.facts(huge).plainAssignments.length, 0);
  });
});
```

`tableArg`가 없는 경우를 만들려면 인자가 **변수**여야 한다. 테이블 조각은 메서드 이름을 보지 않고
첫 문자열 인자를 그대로 잡으므로 `get_record_sql('SELECT 1')`은 `tableArg: 'SELECT 1'`을 낸다 —
교체 대상 구현도 같다.

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx mocha test/unit/php/php-syntax.test.ts`
Expected: FAIL — `Cannot find module '.../php-syntax'`

- [ ] **Step 3: 구현한다**

```ts
// src/infrastructure/php/php-syntax.ts
import { DocumentFacts, RecordAssignment, emptyFacts } from '../../domain/code-analysis/facts';
import { PhpSyntax, RawClassMember } from '../../domain/code-analysis/ports/php-syntax';
import { readClassMembers } from './class-members';
import { FragmentSet } from './fragment-set';
import { accessFragments } from './fragments/access';
import { configFragments } from './fragments/config';
import { recordFragments } from './fragments/record';
import { stringFragments } from './fragments/strings';
import { tableFragments } from './fragments/tables';
import { templateFragments } from './fragments/templates';
import { FactKind } from './query-fragment';
import { ScopeTable } from './scope-table';
import { CompiledQuery, PhpRuntime } from './tree-sitter-runtime';

export const MAX_DOCUMENT_BYTES = 1_048_576;

export const ALL_FRAGMENTS = [
  ...recordFragments, ...accessFragments, ...stringFragments,
  ...configFragments, ...tableFragments, ...templateFragments,
];

export class TreeSitterPhpSyntax implements PhpSyntax {
  private constructor(
    private readonly runtime: PhpRuntime,
    private readonly fragments: FragmentSet,
    private readonly query: CompiledQuery,
  ) {}

  static async create(runtimeDir?: string): Promise<TreeSitterPhpSyntax> {
    const runtime = await PhpRuntime.create(runtimeDir);
    const fragments = FragmentSet.of(ALL_FRAGMENTS);
    return new TreeSitterPhpSyntax(runtime, fragments, runtime.compile(fragments.source));
  }

  facts(text: string, need?: ReadonlySet<FactKind>): DocumentFacts {
    if (Buffer.byteLength(text) > MAX_DOCUMENT_BYTES) return emptyFacts();
    const doc = this.runtime.parse(text);
    if (!doc) return emptyFacts();
    const facts = emptyFacts();
    const scopes = ScopeTable.of(doc.scopeRanges(), doc.endIndex);
    this.fragments.collect(doc.run(this.query, scopes), {
      add: (kind, fact) => { (facts[kind] as unknown[]).push(fact); },
    }, need);
    doc.dispose();
    facts.assignments = preferTableArg(facts.assignments);
    facts.foreachBindings = uniqueByIndex(facts.foreachBindings);
    return facts;
  }

  classMembers(text: string, className: string): RawClassMember[] {
    const doc = this.runtime.parse(text);
    if (!doc) return [];
    const body = doc.classBody(className);
    const members = body ? readClassMembers(body) : [];
    doc.dispose();
    return members;
  }
}

function preferTableArg(assignments: RecordAssignment[]): RecordAssignment[] {
  const best = new Map<number, RecordAssignment>();
  for (const a of assignments) {
    const kept = best.get(a.index);
    if (!kept || (kept.tableArg === null && a.tableArg !== null)) best.set(a.index, a);
  }
  return [...best.values()];
}

function uniqueByIndex<T extends { index: number }>(items: T[]): T[] {
  const seen = new Set<number>();
  return items.filter(item => (seen.has(item.index) ? false : (seen.add(item.index), true)));
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx mocha test/unit/php/php-syntax.test.ts`
Expected: PASS (6 passing)

- [ ] **Step 5: 커밋**

```bash
git add src/infrastructure/php/php-syntax.ts test/unit/php/php-syntax.test.ts
git commit -m "feat: PhpSyntax 조립"
```

---

### Task 13: need를 아는 팩트 캐시

**Files:**
- Create: `src/infrastructure/php/facts-cache.ts`
- Test: `test/unit/php/facts-cache.test.ts`

**Interfaces:**
- Consumes: `PhpSyntax`, `DocumentFacts`, `FactKind`
- Produces: `new CachedPhpSyntax(inner: PhpSyntax, capacity?: number)` — `facts`·`classMembers`를 그대로 위임하며 `facts`만 캐시한다

`need`가 다르면 팩트도 다르므로 캐시 키에 들어가야 한다. 그러지 않으면 부분 팩트가 전체 팩트로 오인된다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// test/unit/php/facts-cache.test.ts
import { strict as assert } from 'assert';
import { CachedPhpSyntax } from '../../../src/infrastructure/php/facts-cache';
import { DocumentFacts, emptyFacts } from '../../../src/domain/code-analysis/facts';
import { PhpSyntax, RawClassMember } from '../../../src/domain/code-analysis/ports/php-syntax';
import { FactKind } from '../../../src/infrastructure/php/query-fragment';

class Counting implements PhpSyntax {
  calls = 0;
  classMembers(): RawClassMember[] { return []; }
  facts(_text: string, _need?: ReadonlySet<FactKind>): DocumentFacts { this.calls++; return emptyFacts(); }
}

describe('CachedPhpSyntax', () => {
  it('같은 텍스트·같은 need는 한 번만 파싱한다', () => {
    const inner = new Counting();
    const cached = new CachedPhpSyntax(inner);
    const need = new Set<FactKind>(['stringCalls']);
    assert.equal(cached.facts('<?php $a = 1;', need), cached.facts('<?php $a = 1;', need));
    assert.equal(inner.calls, 1);
  });

  it('need가 다르면 다시 파싱한다', () => {
    const inner = new Counting();
    const cached = new CachedPhpSyntax(inner);
    cached.facts('<?php $a = 1;', new Set<FactKind>(['stringCalls']));
    cached.facts('<?php $a = 1;', new Set<FactKind>(['tableRefs']));
    cached.facts('<?php $a = 1;');
    assert.equal(inner.calls, 3);
  });

  it('용량을 넘으면 가장 오래된 것을 버린다', () => {
    const inner = new Counting();
    const cached = new CachedPhpSyntax(inner, 2);
    cached.facts('a'); cached.facts('b'); cached.facts('c'); cached.facts('a');
    assert.equal(inner.calls, 4);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx mocha test/unit/php/facts-cache.test.ts`
Expected: FAIL — `Cannot find module '.../facts-cache'`

- [ ] **Step 3: 구현한다**

```ts
// src/infrastructure/php/facts-cache.ts
import { DocumentFacts } from '../../domain/code-analysis/facts';
import { PhpSyntax, RawClassMember } from '../../domain/code-analysis/ports/php-syntax';
import { FactKind } from './query-fragment';

export class CachedPhpSyntax implements PhpSyntax {
  private readonly entries = new Map<string, DocumentFacts>();

  constructor(private readonly inner: PhpSyntax, private readonly capacity = 8) {}

  classMembers(text: string, className: string): RawClassMember[] {
    return this.inner.classMembers(text, className);
  }

  facts(text: string, need?: ReadonlySet<FactKind>): DocumentFacts {
    const key = `${needKey(need)} ${text}`;
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    const facts = this.inner.facts(text, need);
    this.entries.set(key, facts);
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return facts;
  }
}

function needKey(need: ReadonlySet<FactKind> | undefined): string {
  return need ? [...need].sort().join(',') : '*';
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx mocha test/unit/php/facts-cache.test.ts`
Expected: PASS (3 passing)

- [ ] **Step 5: 커밋**

```bash
git add src/infrastructure/php/facts-cache.ts test/unit/php/facts-cache.test.ts
git commit -m "feat: need를 아는 팩트 캐시"
```

---

### Task 14: 통합 쿼리 등가성 게이트

**Files:**
- Create: `test/unit/php/combined-query-equivalence.test.ts`

**Interfaces:**
- Consumes: `FragmentSet` (Task 4), `PhpRuntime` (Task 3), `ALL_FRAGMENTS` (Task 12)

조각을 하나씩 따로 컴파일했을 때와 통합 쿼리의 **패턴별 매치 수**가 같아야 한다. 총합만 비교하면 오분배를 놓친다 — 총합은 같고 귀속만 어긋나는 것이 정확히 이 실패 모드다. 코퍼스가 있으면 실제 파일까지 확인하고, 없으면 픽스처만으로도 게이트가 선다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// test/unit/php/combined-query-equivalence.test.ts
import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { FragmentSet } from '../../../src/infrastructure/php/fragment-set';
import { PhpRuntime } from '../../../src/infrastructure/php/tree-sitter-runtime';
import { ScopeTable } from '../../../src/infrastructure/php/scope-table';
import { ALL_FRAGMENTS as FRAGMENTS } from '../../../src/infrastructure/php/php-syntax';

function fixturePhpFiles(): string[] {
  const root = path.join(__dirname, '../../fixtures');
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.name.endsWith('.php')) out.push(p);
    }
  };
  walk(root);
  return out;
}

function corpusPhpFiles(limit: number): string[] {
  const root = process.env.CSMS_CORPUS;
  if (!root || !fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    if (out.length >= limit) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of entries) {
      if (out.length >= limit) return;
      if (d.name === 'node_modules' || d.name === '.git' || d.name === 'vendor') continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.name.endsWith('.php') && fs.statSync(p).size < 200_000) out.push(p);
    }
  };
  walk(root);
  return out;
}

describe('통합 쿼리 등가성', () => {
  let runtime: PhpRuntime;
  let set: FragmentSet;
  let combined: ReturnType<PhpRuntime['compile']>;
  let singles: ReturnType<PhpRuntime['compile']>[];

  before(async () => {
    runtime = await PhpRuntime.create();
    set = FragmentSet.of(FRAGMENTS);
    combined = runtime.compile(set.source);
    singles = FRAGMENTS.map(f => runtime.compile(f.pattern));
  });

  const check = (file: string) => {
    const text = fs.readFileSync(file, 'utf8');
    const doc = runtime.parse(text);
    if (!doc) return;
    const scopes = ScopeTable.of([], doc.endIndex);
    const byPattern = new Map<number, number>();
    for (const m of doc.run(combined, scopes)) {
      byPattern.set(m.patternIndex, (byPattern.get(m.patternIndex) ?? 0) + 1);
    }
    singles.forEach((single, i) => {
      const alone = [...doc.run(single, scopes)].length;
      assert.equal(byPattern.get(i) ?? 0, alone, `${path.basename(file)} 조각 ${i}`);
    });
    doc.dispose();
  };

  it('픽스처 PHP 파일에서 패턴별 매치 수가 같다', () => {
    const files = fixturePhpFiles();
    assert.ok(files.length > 0);
    files.forEach(check);
  });

  it('코퍼스 PHP 파일에서 패턴별 매치 수가 같다', function () {
    const files = corpusPhpFiles(300);
    if (files.length === 0) this.skip();
    files.forEach(check);
  });
});
```

- [ ] **Step 2: 테스트를 실행한다**

Run: `npx mocha test/unit/php/combined-query-equivalence.test.ts`
Expected: PASS (2 passing 또는 코퍼스 없으면 1 passing / 1 pending)

- [ ] **Step 3: 게이트가 실제 밀림을 잡는지 확인한다**

`FragmentSet.of`의 불변식이 없으면 어떤 일이 일어나는지 확인해, 이 테스트가 그 실패를 잡는지 본다.
`src/infrastructure/php/fragment-set.ts`의 `if (count !== 1) throw ...` 줄을 잠시 주석 처리하고,
테스트 파일에서 `FRAGMENTS`를 직접 쓰는 대신 첫 원소를 바꾼 사본을 만들어 실행한다.

```ts
const FRAGMENTS = [
  { ...ALL_FRAGMENTS[0], pattern: `${ALL_FRAGMENTS[0].pattern}\n(comment) @extra` },
  ...ALL_FRAGMENTS.slice(1),
];
```

Run: `npx mocha test/unit/php/combined-query-equivalence.test.ts`
Expected: FAIL — `조각 1` 이후가 한 칸씩 밀려 매치 수가 어긋난다. 이 게이트가 잡으려는 실패 모드다.

- [ ] **Step 4: 불변식을 되살려 조각 단계에서 먼저 걸리는지 확인한다**

주석 처리한 `throw` 줄을 되돌리고 같은 테스트를 실행한다.

Run: `npx mocha test/unit/php/combined-query-equivalence.test.ts`
Expected: FAIL — `조각 0의 최상위 패턴이 2개다` (밀림이 아니라 생성 시점에 걸린다)

- [ ] **Step 5: 실험을 되돌리고 커밋**

임시로 만든 `FRAGMENTS` 사본을 지우고 `ALL_FRAGMENTS`를 그대로 쓰는 형태로 되돌린다(테스트 파일은 아직 커밋 전이라 `git checkout`으로는 되돌아오지 않는다).

```bash
git checkout -- src/infrastructure/php/fragment-set.ts
npx mocha test/unit/php/combined-query-equivalence.test.ts
```
Expected: PASS

```bash
git add test/unit/php/combined-query-equivalence.test.ts
git commit -m "test: 통합 쿼리 패턴별 등가성 게이트"
```

---

### Task 15: 팩트 diff 하네스와 옛 구현 대조

**Files:**
- Create: `test/tools/facts-diff.ts`
- Test: `test/unit/php/facts-diff.test.ts`

**Interfaces:**
- Consumes: `PhpSyntax`, `DocumentFacts`
- Produces:
  - `diffFacts(a: DocumentFacts, b: DocumentFacts): FactDifference[]`
  - `FactDifference`: `{ kind: FactKind; onlyInA: string[]; onlyInB: string[] }`
  - `compareOverFiles(a: PhpSyntax, b: PhpSyntax, files: string[]): Map<string, FactDifference[]>`

배열 순서는 통합 쿼리에서 문서 순서로 섞이지만 소비자는 전부 인덱스로 조회하므로 동작에 영향이 없다. 따라서 비교는 **순서를 무시**하고 정규화한 문자열 다중집합으로 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// test/unit/php/facts-diff.test.ts
import { strict as assert } from 'assert';
import { compareOverFiles, diffFacts } from '../../tools/facts-diff';
import { emptyFacts } from '../../../src/domain/code-analysis/facts';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/php/php-syntax';
import { TreeSitterPhpSyntax as LegacyPhpSyntax } from '../../../src/infrastructure/tree-sitter/tree-sitter-php-syntax';
import * as fs from 'fs';
import * as path from 'path';

describe('facts-diff', () => {
  it('순서만 다른 팩트는 차이가 아니다', () => {
    const a = emptyFacts(); const b = emptyFacts();
    a.tableRefs.push({ name: 'x', nameLine: 1, nameColumn: 0, nameIndex: 10 });
    a.tableRefs.push({ name: 'y', nameLine: 2, nameColumn: 0, nameIndex: 20 });
    b.tableRefs.push({ name: 'y', nameLine: 2, nameColumn: 0, nameIndex: 20 });
    b.tableRefs.push({ name: 'x', nameLine: 1, nameColumn: 0, nameIndex: 10 });
    assert.deepEqual(diffFacts(a, b), []);
  });

  it('스코프만 달라도 차이로 잡는다', () => {
    const a = emptyFacts(); const b = emptyFacts();
    a.plainAssignments.push({ varName: 'x', index: 5, scope: { start: 0, end: 100 } });
    b.plainAssignments.push({ varName: 'x', index: 5, scope: { start: 0, end: 200 } });
    assert.equal(diffFacts(a, b).length, 1);
  });

  it('값이 다르면 차이로 잡는다', () => {
    const a = emptyFacts(); const b = emptyFacts();
    a.tableRefs.push({ name: 'x', nameLine: 1, nameColumn: 0, nameIndex: 10 });
    const d = diffFacts(a, b);
    assert.equal(d.length, 1);
    assert.equal(d[0].kind, 'tableRefs');
  });

  it('픽스처 전체에서 옛 구현과 새 구현의 팩트가 같다', async () => {
    const [legacy, next] = await Promise.all([LegacyPhpSyntax.create(), TreeSitterPhpSyntax.create()]);
    const root = path.join(__dirname, '../../fixtures');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) walk(p); else if (d.name.endsWith('.php')) files.push(p);
      }
    };
    walk(root);
    const differences = compareOverFiles(legacy, next, files);
    assert.deepEqual([...differences.keys()], []);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx mocha test/unit/php/facts-diff.test.ts`
Expected: FAIL — `Cannot find module '../../tools/facts-diff'`

- [ ] **Step 3: 구현한다**

```ts
// test/tools/facts-diff.ts
import * as fs from 'fs';
import { DocumentFacts } from '../../src/domain/code-analysis/facts';
import { PhpSyntax } from '../../src/domain/code-analysis/ports/php-syntax';

export type FactKind = keyof DocumentFacts;

export interface FactDifference { kind: FactKind; onlyInA: string[]; onlyInB: string[] }

// JSON.stringify의 replacer 배열은 모든 깊이에서 같은 키 목록만 남긴다 —
// 최상위 키만 넘기면 중첩된 scope가 {}로 지워져 스코프 차이가 diff에 안 잡힌다.
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

function multiset(list: readonly unknown[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of list) {
    const key = canonical(item);
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

function surplus(a: Map<string, number>, b: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [key, count] of a) {
    const extra = count - (b.get(key) ?? 0);
    for (let i = 0; i < extra; i++) out.push(key);
  }
  return out;
}

export function diffFacts(a: DocumentFacts, b: DocumentFacts): FactDifference[] {
  const out: FactDifference[] = [];
  for (const kind of Object.keys(a) as FactKind[]) {
    const left = multiset(a[kind]);
    const right = multiset(b[kind]);
    const onlyInA = surplus(left, right);
    const onlyInB = surplus(right, left);
    if (onlyInA.length || onlyInB.length) out.push({ kind, onlyInA, onlyInB });
  }
  return out;
}

export function compareOverFiles(a: PhpSyntax, b: PhpSyntax, files: readonly string[]): Map<string, FactDifference[]> {
  const out = new Map<string, FactDifference[]>();
  for (const file of files) {
    let text: string;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const differences = diffFacts(a.facts(text), b.facts(text));
    if (differences.length) out.set(file, differences);
  }
  return out;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx mocha test/unit/php/facts-diff.test.ts`
Expected: PASS (3 passing)

- [ ] **Step 5: 실제 코퍼스에서 대조하고 결과를 확인한다**

```bash
cat > /tmp/corpus-diff.ts <<'TS'
import * as fs from 'fs';
import * as path from 'path';
import { compareOverFiles } from './test/tools/facts-diff';
import { TreeSitterPhpSyntax } from './src/infrastructure/php/php-syntax';
import { TreeSitterPhpSyntax as LegacyPhpSyntax } from './src/infrastructure/tree-sitter/tree-sitter-php-syntax';

(async () => {
  const root = process.env.CSMS_CORPUS!;
  const files: string[] = [];
  const walk = (dir: string) => {
    if (files.length >= 2000) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of entries) {
      if (files.length >= 2000) return;
      if (d.name === 'node_modules' || d.name === '.git' || d.name === 'vendor') continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.name.endsWith('.php') && fs.statSync(p).size < 200_000) files.push(p);
    }
  };
  walk(root);
  const [legacy, next] = await Promise.all([LegacyPhpSyntax.create(), TreeSitterPhpSyntax.create()]);
  const differences = compareOverFiles(legacy, next, files);
  console.log(`파일 ${files.length}개 중 차이 ${differences.size}개`);
  let shown = 0;
  for (const [file, list] of differences) {
    if (shown++ >= 10) break;
    console.log(file, JSON.stringify(list).slice(0, 400));
  }
})();
TS
CSMS_CORPUS=~/workspace/csms45 npx ts-node -O '{"module":"commonjs","target":"ES2021","esModuleInterop":true,"skipLibCheck":true,"strict":false}' /tmp/corpus-diff.ts
```

Expected: `차이 0개`. 차이가 나오면 그 조각을 고치고 이 단계를 다시 돌린다 — **차이가 0이 되기 전에는 다음 태스크로 가지 않는다.**

- [ ] **Step 6: 커밋**

```bash
git add test/tools/facts-diff.ts test/unit/php/facts-diff.test.ts
git commit -m "test: 팩트 diff 하네스와 옛 구현 대조"
```

---

### Task 16: 배선 교체와 옛 구현 삭제

**Files:**
- Modify: `src/extension.ts:5-6` (import), `src/extension.ts:107-109` (생성)
- Delete: `src/infrastructure/tree-sitter/tree-sitter-php-syntax.ts`, `src/infrastructure/caching/cached-php-syntax.ts`, `test/unit/infra/tree-sitter.test.ts`, `test/unit/infra/cached-php-syntax.test.ts`
- Modify: `test/unit/php/facts-diff.test.ts` (옛 구현 대조 케이스 제거)

**Interfaces:**
- Consumes: `TreeSitterPhpSyntax` (Task 12), `CachedPhpSyntax` (Task 13)

- [ ] **Step 1: 배선을 바꾼다**

`src/extension.ts`의 import 두 줄을 새 경로로 바꾼다.

```ts
import { TreeSitterPhpSyntax } from './infrastructure/php/php-syntax';
import { CachedPhpSyntax } from './infrastructure/php/facts-cache';
```

생성 지점은 그대로 둔다 — 생성자 시그니처가 같다.

```ts
    syntax = new CachedPhpSyntax(await TreeSitterPhpSyntax.create(path.join(ctx.extensionPath, 'dist')), 8);
```

- [ ] **Step 2: 전체 단위 테스트를 돌려 옛 테스트가 아직 통과하는지 확인한다**

Run: `npm run test:unit`
Expected: PASS — 옛 구현이 아직 남아 있으므로 옛 테스트도 함께 통과한다

- [ ] **Step 3: 옛 구현과 그 테스트를 지운다**

```bash
git rm src/infrastructure/tree-sitter/tree-sitter-php-syntax.ts
git rm src/infrastructure/caching/cached-php-syntax.ts
git rm test/unit/infra/tree-sitter.test.ts
git rm test/unit/infra/cached-php-syntax.test.ts
```

`test/unit/php/facts-diff.test.ts`에서 `LegacyPhpSyntax` import와 `'픽스처 전체에서 옛 구현과 새 구현의 팩트가 같다'` 케이스를 지운다. 나머지 두 케이스와 `test/tools/facts-diff.ts`는 Task 17의 문법 대조에 그대로 쓴다.

- [ ] **Step 4: 컴파일과 전체 테스트를 돌린다**

```bash
npx tsc -noEmit && npm run test:unit && npm run lint
```
Expected: 세 명령 모두 통과

- [ ] **Step 5: tree-sitter 타입이 문법 계층 밖으로 나가지 않는지 확인한다**

```bash
grep -rln "web-tree-sitter" src | grep -v "^src/infrastructure/php/" || echo "격리 OK"
```
Expected: `격리 OK`

- [ ] **Step 6: 통합 테스트를 돌린다**

Run: `xvfb-run -a npm run test:integration`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "refactor: 문법 계층을 조각 기반 구현으로 교체"
```

---

### Task 17: 런타임·문법 업그레이드 (1b)

**Files:**
- Modify: `package.json` (dependencies), `esbuild.mjs`, `src/infrastructure/php/tree-sitter-runtime.ts`, `src/infrastructure/php/class-members.ts`, `src/infrastructure/php/fragments/strings.ts`, `test/tools/facts-diff.ts` (`factFingerprint` 추가)
- Test: `test/unit/php/hex-escape.test.ts`

**Interfaces:**
- Consumes: Task 12의 `TreeSitterPhpSyntax`, Task 15의 `canonical`
- Produces: `factFingerprint(facts: DocumentFacts): Record<string, string>` — 팩트 종류별 정규 해시

`web-tree-sitter@0.27.0`은 ESM 기본이라 esbuild CJS 번들에서 `import.meta.url`이 `undefined`가 되고 emscripten의 wasm 탐색이 `new URL(undefined)`로 실패한다. 배너로 파일 URL을 넣어 준다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// test/unit/php/hex-escape.test.ts
import { strict as assert } from 'assert';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/php/php-syntax';

const CODE = `<?php
$sep = "\\x1f";
echo get_string('key', 'local_x');
$DB->get_record('user', []);
`;

describe('16진 이스케이프', () => {
  it('이스케이프가 있어도 팩트가 나온다', async () => {
    const syntax = await TreeSitterPhpSyntax.create();
    const f = syntax.facts(CODE);
    assert.equal(f.stringCalls.length, 1);
    assert.ok(f.tableRefs.some(r => r.name === 'user'));
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx mocha test/unit/php/hex-escape.test.ts`
Expected: FAIL — 파싱이 예외를 던져 팩트가 비고 `stringCalls.length`가 0이다

- [ ] **Step 3: 구 문법 팩트의 지문을 먼저 저장한다**

문법 교체 뒤에는 옛 조합을 되살릴 수 없다(`node_modules`가 바뀐다). 비교 대상을 지금 남긴다.
팩트를 통째로 직렬화하면 수십 MB가 되고 JSON 왕복이 값 동일성에 잡음을 넣으므로,
**파일·팩트 종류별 정규 해시**만 남긴다. 어느 파일의 어느 종류가 달라졌는지 가리기에 충분하고,
상세는 그 파일만 다시 뽑으면 된다.

`test/tools/facts-diff.ts`에 지문 함수를 더한다.

```ts
import * as crypto from 'crypto';

export function factFingerprint(facts: DocumentFacts): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kind of Object.keys(facts) as FactKind[]) {
    const rows = facts[kind].map(canonical).sort();
    out[kind] = crypto.createHash('sha1').update(rows.join('\u0000')).digest('hex');
  }
  return out;
}
```

```bash
CSMS_CORPUS=~/workspace/csms45 npx ts-node -O '{"module":"commonjs","target":"ES2021","esModuleInterop":true,"skipLibCheck":true,"strict":false}' -e "
import * as fs from 'fs'; import * as path from 'path';
import { factFingerprint } from './test/tools/facts-diff';
import { TreeSitterPhpSyntax } from './src/infrastructure/php/php-syntax';
(async () => {
  const syntax = await TreeSitterPhpSyntax.create();
  const files: string[] = [];
  const walk = (d: string) => {
    if (files.length >= 2000) return;
    let e: fs.Dirent[]; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const x of e) { if (files.length >= 2000) return;
      if (['node_modules', '.git', 'vendor'].includes(x.name)) continue;
      const p = path.join(d, x.name);
      if (x.isDirectory()) walk(p);
      else if (x.name.endsWith('.php') && fs.statSync(p).size < 200000) files.push(p); } };
  walk(process.env.CSMS_CORPUS!);
  const out: Record<string, Record<string, string>> = {};
  for (const f of files) out[f] = factFingerprint(syntax.facts(fs.readFileSync(f, 'utf8')));
  fs.writeFileSync('/tmp/facts-old-grammar.json', JSON.stringify(out));
  console.log('구 문법 지문 저장:', files.length, '파일');
})();
"
```
Expected: `구 문법 지문 저장: 2000 파일`

- [ ] **Step 4: 의존성을 바꾼다**

```bash
npm uninstall tree-sitter-wasms
npm install web-tree-sitter@0.27.0 tree-sitter-php@0.24.2
```

- [ ] **Step 5: 런타임 어댑터를 새 API에 맞춘다**

`src/infrastructure/php/tree-sitter-runtime.ts`의 import와 생성 경로를 바꾼다. 나머지(`ParsedDocument`·`NodeCaptures`·`patternIndexOf`)는 그대로 둔다 — `patternIndexOf`가 `patternIndex`를 먼저 읽으므로 이미 새 런타임을 받는다.

```ts
import { Language, Parser, Query } from 'web-tree-sitter';

export type CompiledQuery = Query;

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
```

타입 참조(`Parser.SyntaxNode` → `Node`, `Parser.Tree` → `Tree`, `Parser.QueryMatch` → `QueryMatch`)를 새 패키지의 이름으로 바꾼다. `class-members.ts`의 `Parser.SyntaxNode`도 함께 바꾼다.

- [ ] **Step 6: 새 문법에서 사라진 노드 이름을 고친다**

`tree-sitter-php@0.24.2`에는 `property_initializer` 노드가 없다. `src/infrastructure/php/fragments/strings.ts`의 `propertyLiteral` 패턴을 바꾼다.

```ts
const propertyLiteral: QueryFragment = {
  produces: ['propertyLiterals'],
  pattern: `(property_declaration (property_element
    (variable_name (name) @prop) (string (string_content) @value)))`,
  collect: (at, into) => into.add('propertyLiterals', {
    property: at.text('prop'), value: at.text('value'), index: at.index('prop'),
  }),
};
```

패턴이 컴파일되는지 먼저 확인한다.

Run: `npx mocha test/unit/php/fragments-strings.test.ts`
Expected: PASS (5 passing). 실패하면 아래로 실제 노드 이름을 확인하고 패턴을 고친다.

```bash
cat > /tmp/sexp.ts <<'TS'
import { PhpRuntime } from './src/infrastructure/php/tree-sitter-runtime';
(async () => {
  const runtime = await PhpRuntime.create();
  const doc = runtime.parse('<?php class C { public $p = \'lit\'; }')!;
  console.log((doc as unknown as { tree: { rootNode: { toString(): string } } }).tree.rootNode.toString());
})();
TS
npx ts-node -O '{"module":"commonjs","target":"ES2021","esModuleInterop":true,"skipLibCheck":true,"strict":false}' /tmp/sexp.ts
```

- [ ] **Step 7: esbuild를 고친다**

`esbuild.mjs`의 wasm 복사 경로와 빌드 옵션을 바꾼다.

```js
copyFileSync(
  join(__dirname, 'node_modules/web-tree-sitter/web-tree-sitter.wasm'),
  join(__dirname, 'dist/web-tree-sitter.wasm'));
copyFileSync(
  join(__dirname, 'node_modules/tree-sitter-php/tree-sitter-php.wasm'),
  join(__dirname, 'dist/tree-sitter-php.wasm'));

await esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true, outfile: 'dist/extension.js',
  external: ['vscode'], format: 'cjs', platform: 'node',
  minify: production, sourcemap: !production,
  banner: { js: 'const __ts_import_meta_url = require("url").pathToFileURL(__filename).href;' },
  define: { 'import.meta.url': '__ts_import_meta_url' },
});
```

- [ ] **Step 8: 16진 이스케이프 테스트가 통과하는지 확인한다**

Run: `npx mocha test/unit/php/hex-escape.test.ts`
Expected: PASS (1 passing)

- [ ] **Step 9: 문법 교체로 생긴 팩트 차이를 전부 확인한다**

```bash
npx ts-node -O '{"module":"commonjs","target":"ES2021","esModuleInterop":true,"skipLibCheck":true,"strict":false}' -e "
import * as fs from 'fs';
import { factFingerprint } from './test/tools/facts-diff';
import { TreeSitterPhpSyntax } from './src/infrastructure/php/php-syntax';
(async () => {
  const syntax = await TreeSitterPhpSyntax.create();
  const before: Record<string, Record<string, string>> = JSON.parse(fs.readFileSync('/tmp/facts-old-grammar.json', 'utf8'));
  const changed: [string, string[]][] = [];
  const byKind = new Map<string, number>();
  for (const [file, prints] of Object.entries(before)) {
    const now = factFingerprint(syntax.facts(fs.readFileSync(file, 'utf8')));
    const kinds = Object.keys(prints).filter(k => prints[k] !== now[k]);
    if (!kinds.length) continue;
    changed.push([file, kinds]);
    for (const k of kinds) byKind.set(k, (byKind.get(k) ?? 0) + 1);
  }
  console.log('차이 파일', changed.length, '/', Object.keys(before).length);
  console.log('종류별', [...byKind]);
  fs.writeFileSync('/tmp/grammar-diff-files.json', JSON.stringify(changed));
  changed.slice(0, 20).forEach(([f, k]) => console.log(' ', f, k.join(',')));
})();
"
```

차이가 난 파일 목록은 `/tmp/grammar-diff-files.json`에 남는다. 자동 분류는 하지 않는다 — "최신 PHP 문법"을
정규식으로 가르려 하면 URL·배열 리터럴에도 걸려 진짜 문법 회귀가 설명된 차이로 묻힌다.

목록의 파일을 하나씩 열어 셋 중 하나로 분류한다.

1. **16진 이스케이프** — 옛 문법이 예외를 던져 팩트가 비어 있던 파일. 새 문법에서 팩트가 생긴 것이 정상이다.
2. **최신 PHP 문법** — enum·readonly·named argument·first-class callable 등 옛 문법이 못 읽던 구문이 있는 파일.
3. **설명 안 됨** — 위 둘 다 아닌 차이. 조각이 신 문법의 노드 이름·트리 모양과 어긋난 것이다.

3번이 하나라도 있으면 해당 조각을 신 문법의 노드 이름·트리 모양에 맞게 고치고 Step 9를 다시 돌린다.
어느 조각인지는 Step 9가 찍는 **종류별 집계**가 가리킨다 — 예를 들어 `propertyLiterals`만 달라졌다면
Step 6에서 고친 패턴이 여전히 어긋난 것이다. 해당 파일의 실제 트리는 Step 6의 s-expression 출력 방법으로 본다.

Step 3이 지문만 저장하므로 옛 팩트의 상세는 남아 있지 않다. 분류의 근거는 **바뀐 팩트 종류 + 파일 내용**이다.

**3번이 0이 되기 전에는 커밋하지 않는다.**

- [ ] **Step 10: 전체 검증**

```bash
npx tsc -noEmit && npm run test:unit && npm run lint && npm run bundle
```
Expected: 모두 통과

```bash
node -e "require('./dist/extension.js'); console.log('번들 로드 OK')"
```
Expected: `번들 로드 OK`

Run: `xvfb-run -a npm run test:integration`
Expected: PASS

- [ ] **Step 11: 커밋**

```bash
git add -A
git commit -m "feat: tree-sitter 런타임·PHP 문법 업그레이드 — 16진 이스케이프 파싱 복구"
```

---

### Task 18: 성능 확인과 릴리스 준비

**Files:**
- Create: `test/unit/php/facts-budget.test.ts`
- Modify: `package.json` (version), `CHANGELOG.md`, `docs/FEATURES.md:§13`

**Interfaces:**
- Consumes: Task 12의 `TreeSitterPhpSyntax`

- [ ] **Step 1: 예산 테스트를 쓴다**

```ts
// test/unit/php/facts-budget.test.ts
import { strict as assert } from 'assert';
import * as fs from 'fs';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/php/php-syntax';

const BUDGET_MS = 8;

describe('facts 예산', () => {
  it('14KB급 파일에서 예산 안에 끝난다', async function () {
    const file = process.env.CSMS_BUDGET_FILE;
    if (!file || !fs.existsSync(file)) this.skip();
    this.timeout(20000);
    const syntax = await TreeSitterPhpSyntax.create();
    const text = fs.readFileSync(file, 'utf8');
    for (let i = 0; i < 5; i++) syntax.facts(text);
    const started = process.hrtime.bigint();
    for (let i = 0; i < 20; i++) syntax.facts(text);
    const each = Number(process.hrtime.bigint() - started) / 1e6 / 20;
    assert.ok(each < BUDGET_MS, `${each.toFixed(2)}ms > ${BUDGET_MS}ms`);
  });
});
```

- [ ] **Step 2: 실제 파일로 돌려 수치를 확인한다**

```bash
CSMS_BUDGET_FILE=~/workspace/csms45/local/manager/lib.php npx mocha test/unit/php/facts-budget.test.ts
```
Expected: PASS. 실패하면 수치를 기록하고 어느 단계가 예산을 먹는지 확인한다.

- [ ] **Step 3: 기준선과 비교해 수치를 기록한다**

```bash
CSMS_BUDGET_FILE=~/workspace/csms45/local/manager/lib.php npx ts-node -O '{"module":"commonjs","target":"ES2021","esModuleInterop":true,"skipLibCheck":true,"strict":false}' -e "
import * as fs from 'fs';
import { TreeSitterPhpSyntax } from './src/infrastructure/php/php-syntax';
(async () => {
  const syntax = await TreeSitterPhpSyntax.create();
  const text = fs.readFileSync(process.env.CSMS_BUDGET_FILE!, 'utf8');
  for (let i = 0; i < 5; i++) syntax.facts(text);
  const t = process.hrtime.bigint();
  for (let i = 0; i < 20; i++) syntax.facts(text);
  console.log('facts():', (Number(process.hrtime.bigint() - t) / 1e6 / 20).toFixed(2), 'ms (기준선 17.0ms)');
})();
"
```

- [ ] **Step 4: 문서와 버전을 갱신한다**

`docs/FEATURES.md`의 §13 "파싱" 문단에서 16진 이스케이프 한계 서술을 지운다. 지울 문장:

> `"\x00"` 같은 16진 이스케이프가 있는 PHP 파일은 현재 tree-sitter 조합에서 파싱이 실패해 **그 파일의** 인텔리전스가 전부 침묵합니다. 실패하면 파서 상태를 버려 다음 문서는 영향받지 않습니다.

대체 문장:

> 파싱에 실패한 파일은 팩트 없음으로 떨어져 그 파일의 인텔리전스만 조용히 침묵하고, 파서 상태를 버려 다음 문서는 영향받지 않습니다. 1MB를 넘는 파일도 같은 처리를 합니다.

`package.json`의 `version`을 `0.22.0`으로 올리고 `CHANGELOG.md` 맨 위에 항목을 넣는다.

```markdown
## 0.22.0

- PHP 문법 계층 재작성 — 쿼리 조각 27개를 통합 쿼리 하나로 합치고 패턴 인덱스로 분기. `facts()` 17.0ms → 측정치 기입
- tree-sitter 런타임·PHP 문법 업그레이드 — 16진 이스케이프(`"\x41"`)가 든 파일에서 인텔리전스가 침묵하던 문제 해결
- 1MB를 넘는 파일은 팩트 없음으로 처리
```

측정치 기입 자리에 Step 3의 실제 수치를 적는다.

- [ ] **Step 5: 전체 검증 후 커밋**

```bash
npx tsc -noEmit && npm run test:unit && npm run lint
git add -A
git commit -m "chore: 0.22.0 — 문법 계층 재작성"
```

---

## 다음 단계

스펙의 2단계(색인 메모리)와 3단계(순회·워처·스냅샷)는 이 계획이 착지한 뒤 각자의 계획을 받는다.
2단계는 이 계획에 의존하지 않으므로 순서를 바꿔도 된다.
