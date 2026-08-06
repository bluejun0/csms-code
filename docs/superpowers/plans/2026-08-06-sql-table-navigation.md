# SQL 테이블 참조 이동 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PHP 문자열 안의 `{table}`에서 F12로 install.xml `<TABLE>` 줄로 이동하고, 해석되는 참조를 하이라이팅한다.

**Architecture:** tree-sitter가 `string_content`·`nowdoc_string` 노드를 잡고, 그 텍스트에서 `{이름}`을 뽑아 `DocumentFacts.tableRefs`에 담는다. 애플리케이션 유즈케이스 두 개(정의 해석·하이라이트 범위)가 기존 `TableRepository` 포트만 써서 판정하고, 프리젠테이션은 기존 템플릿 프로바이더·하이라이트 결선과 같은 형태로 붙인다.

**Tech Stack:** TypeScript, web-tree-sitter(PHP WASM), mocha + ts-node, VS Code API.

## Global Constraints

- 설계 문서: `docs/superpowers/specs/2026-08-06-sql-table-navigation-design.md`. 충돌 시 설계 문서가 우선.
- 계층 규칙(eslint 강제): `domain/`은 fs·vscode·infrastructure 금지, `application/`은 infrastructure 금지.
- 해석되지 않는 참조에는 **아무 반응도 하지 않는다**(진단 금지).
- **주석은 객관적으로만 쓴다** — 날짜·리뷰·계획 번호·변경 이력 서술을 넣지 않고, 불변 조건과 이유만 적는다.
- 테스트는 기존 파일 배치를 따른다: `test/unit/<layer>/<name>.test.ts`.
- 기존 210건 무회귀.

---

### Task 1: 팩트 추출 — `tableRefs`

**Files:**
- Modify: `src/domain/code-analysis/facts.ts`
- Modify: `src/infrastructure/tree-sitter/tree-sitter-php-syntax.ts`
- Test: `test/unit/infrastructure/tree-sitter-php-syntax.test.ts`

**Interfaces:**
- Produces: `TableRef { name: string; nameLine: number; nameColumn: number; nameIndex: number }`, `DocumentFacts.tableRefs: TableRef[]`

- [ ] **Step 1: 실패하는 테스트 작성** — 기존 테스트 파일 맨 아래 `describe('tableRefs', …)` 추가

```ts
  describe('tableRefs', () => {
    it('단일 인용 SQL의 {table}을 뽑는다', () => {
      const text = `<?php\n$sql = 'SELECT * FROM {course} WHERE id = ?';\n`;
      const refs = syntax.facts(text).tableRefs;
      assert.deepStrictEqual(refs.map(r => r.name), ['course']);
      const line = text.split('\n')[1];
      assert.strictEqual(refs[0].nameLine, 1);
      assert.strictEqual(refs[0].nameColumn, line.indexOf('course'));
      assert.strictEqual(text.slice(refs[0].nameIndex, refs[0].nameIndex + 6), 'course');
    });

    it('이중 인용·보간 있는 문자열에서도 뽑고 {$var}는 무시한다', () => {
      const text = `<?php\n$sql = "SELECT * FROM {user} u JOIN {course} c WHERE x = {$id}";\n`;
      const refs = syntax.facts(text).tableRefs;
      assert.deepStrictEqual(refs.map(r => r.name), ['user', 'course']);
    });

    it('heredoc 여러 줄에서 줄·컬럼이 정확하다', () => {
      const text = `<?php\n$sql = <<<SQL\nSELECT *\n  FROM {grade_items} gi\nSQL;\n`;
      const refs = syntax.facts(text).tableRefs;
      assert.deepStrictEqual(refs.map(r => r.name), ['grade_items']);
      assert.strictEqual(refs[0].nameLine, 3);
      assert.strictEqual(refs[0].nameColumn, text.split('\n')[3].indexOf('grade_items'));
    });

    it('nowdoc에서도 뽑는다', () => {
      const text = `<?php\n$sql = <<<'SQL'\nFROM {assign}\nSQL;\n`;
      assert.deepStrictEqual(syntax.facts(text).tableRefs.map(r => r.name), ['assign']);
    });

    it('숫자만 있는 {4}도 이름으로 뽑는다(해석 단계에서 걸러진다)', () => {
      const text = `<?php\n$re = '/[0-9]{4}/';\n`;
      assert.deepStrictEqual(syntax.facts(text).tableRefs.map(r => r.name), ['4']);
    });
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:unit -- --grep tableRefs`
Expected: FAIL — `tableRefs`가 `undefined`이라 `.map` 호출에서 TypeError.

- [ ] **Step 3: 팩트 타입 추가** — `facts.ts`

```ts
export interface TableRef {
  name: string;
  nameLine: number; nameColumn: number; nameIndex: number;
}
```
`DocumentFacts`에 `tableRefs: TableRef[];`를 추가한다. `scope` 필드는 두지 않는다.

- [ ] **Step 4: 쿼리와 추출 구현** — `tree-sitter-php-syntax.ts`

쿼리 상수를 다른 상수들 옆에 추가한다.
```ts
// 문자열 내용 노드. string_content 하나가 단일 인용·이중 인용·heredoc를 모두 덮고, nowdoc만 별도 타입이다.
const Q_STRING_BODY = `
  (string_content) @s
  (nowdoc_string) @s`;
```
`CompiledQueries`에 `stringBody: Parser.Query;`를 넣고 `create()`에서 `stringBody: lang.query(Q_STRING_BODY)`로 컴파일한다.

`facts()` 안에서 추출한다. `runMatches`는 캡처를 이름→노드 Map으로 접어 넣으므로 그대로 쓴다.
```ts
    // Moodle SQL은 테이블을 {name}으로 적는다. {$var} 보간은 별도 노드로 쪼개지고 $가 있어 걸리지 않는다.
    const tableRefs: TableRef[] = [];
    const TABLE_REF_RE = /\{(\w+)\}/g;
    for (const { caps } of runMatches(this.queries.stringBody)) {
      const node = caps.get('s')!;
      const body = node.text;
      if (!body.includes('{')) continue;
      // 줄·컬럼은 노드를 한 번만 훑으며 누적한다. 매치마다 앞쪽을 되짚으면 매치 수에 대해 제곱이 된다.
      let line = node.startPosition.row;
      let lineStart = -node.startPosition.column;
      let scanned = 0;
      TABLE_REF_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TABLE_REF_RE.exec(body))) {
        const nameOffset = m.index + 1;
        for (; scanned < nameOffset; scanned++) {
          if (body[scanned] === '\n') { line++; lineStart = scanned + 1; }
        }
        tableRefs.push({
          name: m[1], nameLine: line, nameColumn: nameOffset - lineStart,
          nameIndex: node.startIndex + nameOffset,
        });
      }
    }
```
`facts()` 반환 객체에 `tableRefs`를 추가한다.

`lineStart`를 `-node.startPosition.column`으로 시작하면 첫 줄에서 `nameOffset - lineStart`가 노드의 시작 컬럼을 자동으로 더한다. 줄바꿈을 만나면 문서 컬럼 기준이 0으로 리셋되므로 같은 식이 그대로 성립한다.

- [ ] **Step 5: 통과 확인**

Run: `npm run test:unit`
Expected: PASS — 신규 5건 + 기존 전부.

- [ ] **Step 6: 커밋**

```bash
git add src/domain/code-analysis/facts.ts src/infrastructure/tree-sitter/tree-sitter-php-syntax.ts test/unit/infrastructure/tree-sitter-php-syntax.test.ts
git commit -m "feat(infra): SQL 문자열의 {table} 참조 팩트 추출"
```

---

### Task 2: 유즈케이스 — 정의 해석·하이라이트 범위

**Files:**
- Create: `src/application/resolve-table-definition.ts`
- Create: `src/application/list-resolved-table-refs.ts`
- Test: `test/unit/application/table-navigation.test.ts`

**Interfaces:**
- Consumes: Task 1의 `DocumentFacts.tableRefs`, 기존 `TableRepository.getTable(name)`, 기존 DTO `DefinitionResult`·`RangeItem`
- Produces: `ResolveTableDefinition.run(text, atIndex): DefinitionResult[]`, `ListResolvedTableRefs.run(text): RangeItem[]`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import * as assert from 'assert';
import { ResolveTableDefinition } from '../../../src/application/resolve-table-definition';
import { ListResolvedTableRefs } from '../../../src/application/list-resolved-table-refs';
import { DocumentFacts } from '../../../src/domain/code-analysis/facts';
import { PhpSyntax } from '../../../src/domain/code-analysis/ports/php-syntax';
import { TableRepository } from '../../../src/domain/moodle-model/ports/table-repository';
import { Table } from '../../../src/domain/moodle-model/table';

const EMPTY: DocumentFacts = {
  assignments: [], foreachBindings: [], dataArgBindings: [], phpdocVars: [],
  propertyAccesses: [], plainAssignments: [], stringCalls: [], templateCalls: [], tableRefs: [],
};

function syntaxWith(facts: Partial<DocumentFacts>): PhpSyntax {
  return { facts: () => ({ ...EMPTY, ...facts }) };
}

const courseTable = new Table('course', 'core', [], { uri: '/m/lib/db/install.xml', line: 41, column: 0 });
const repo: TableRepository = {
  getTable: (n) => (n === 'course' ? courseTable : undefined),
  allTableNames: () => ['course'],
};

describe('ResolveTableDefinition', () => {
  const refs = [{ name: 'course', nameLine: 1, nameColumn: 20, nameIndex: 100 }];

  it('색인에 있는 테이블 참조에서 install.xml 위치를 준다', () => {
    const uc = new ResolveTableDefinition(syntaxWith({ tableRefs: refs }), repo);
    assert.deepStrictEqual(uc.run('', 100), [{ location: courseTable.location }]);
  });

  it('이름 끝 문자에서도 해석한다', () => {
    const uc = new ResolveTableDefinition(syntaxWith({ tableRefs: refs }), repo);
    assert.strictEqual(uc.run('', 106).length, 1);
  });

  it('이름 범위 밖이면 빈 배열', () => {
    const uc = new ResolveTableDefinition(syntaxWith({ tableRefs: refs }), repo);
    assert.deepStrictEqual(uc.run('', 99), []);
    assert.deepStrictEqual(uc.run('', 107), []);
  });

  it('색인에 없는 이름이면 빈 배열', () => {
    const uc = new ResolveTableDefinition(
      syntaxWith({ tableRefs: [{ name: '4', nameLine: 0, nameColumn: 0, nameIndex: 10 }] }), repo);
    assert.deepStrictEqual(uc.run('', 10), []);
  });
});

describe('ListResolvedTableRefs', () => {
  it('색인에 있는 참조만 이름 길이만큼 범위를 준다', () => {
    const uc = new ListResolvedTableRefs(syntaxWith({
      tableRefs: [
        { name: 'course', nameLine: 1, nameColumn: 20, nameIndex: 100 },
        { name: 'Bucket', nameLine: 2, nameColumn: 5, nameIndex: 200 },
      ],
    }), repo);
    assert.deepStrictEqual(uc.run(''), [{ line: 1, column0: 20, length: 6 }]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:unit -- --grep Table`
Expected: FAIL — 모듈을 찾을 수 없음.

- [ ] **Step 3: 구현**

`src/application/resolve-table-definition.ts`
```ts
import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { TableRepository } from '../domain/moodle-model/ports/table-repository';
import { DefinitionResult } from './dto';

/** SQL 문자열의 {table} 참조 → install.xml의 TABLE 선언 위치. 색인에 없는 이름은 침묵한다. */
export class ResolveTableDefinition {
  constructor(private syntax: PhpSyntax, private tables: TableRepository) {}
  run(text: string, atIndex: number): DefinitionResult[] {
    const ref = this.syntax.facts(text).tableRefs
      .find(r => r.nameIndex <= atIndex && atIndex <= r.nameIndex + r.name.length);
    if (!ref) return [];
    const table = this.tables.getTable(ref.name);
    return table ? [{ location: table.location }] : [];
  }
}
```

`src/application/list-resolved-table-refs.ts`
```ts
import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { TableRepository } from '../domain/moodle-model/ports/table-repository';
import { RangeItem } from './dto';

/** 색인에 존재하는 테이블 참조의 범위 — 하이라이트용 */
export class ListResolvedTableRefs {
  constructor(private syntax: PhpSyntax, private tables: TableRepository) {}
  run(text: string): RangeItem[] {
    return this.syntax.facts(text).tableRefs
      .filter(r => this.tables.getTable(r.name) !== undefined)
      .map(r => ({ line: r.nameLine, column0: r.nameColumn, length: r.name.length }));
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:unit`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/application/resolve-table-definition.ts src/application/list-resolved-table-refs.ts test/unit/application/table-navigation.test.ts
git commit -m "feat(app): 테이블 참조 정의 해석·하이라이트 범위 유즈케이스"
```

---

### Task 3: 프로바이더 결선 + 설정

**Files:**
- Create: `src/presentation/providers/table-definition-provider.ts`
- Modify: `src/extension.ts`
- Modify: `package.json` (설정 `csmscode.tables.highlightResolved`)
- Test: `test/unit/presentation/highlight-routing.test.ts` (기존 파일에 케이스 추가)

**Interfaces:**
- Consumes: Task 2의 두 유즈케이스, 기존 `registerResolvedHighlight(ctx, HighlightSource[])`

- [ ] **Step 1: 하이라이트 라우팅 테스트 추가** — `test/unit/presentation/highlight-sources.test.ts`는 `pick()`으로 라우팅 규칙을 재현해 계약을 고정한다. 픽스처 `sources`에 테이블 소스를 넣고, php 개수 기대값을 2 → 3으로 고치고 독립성 케이스를 추가한다.

```ts
const B = 'tables.highlightResolved';
// sources 배열에 추가
  { setting: B, languages: ['php'], run: () => [] },
```
```ts
  it('php 문서는 php 소스 3개만', () => {
    const r = pick(sources, 'php', {});
    assert.equal(r.length, 3);
    assert.ok(r.every(s => s.languages.includes('php')));
  });
  it('테이블 하이라이트는 문자열·템플릿 설정과 독립이다', () => {
    const r = pick(sources, 'php', { [S]: false, [T]: false });
    assert.equal(r.length, 1);
    assert.equal(r[0].setting, B);
  });
  it('테이블 설정을 끄면 php에서 테이블만 빠진다', () => {
    const r = pick(sources, 'php', { [B]: false });
    assert.deepEqual(r.map(s => s.setting), [S, T]);
  });
```

- [ ] **Step 2: 프로바이더 작성**

```ts
import * as vscode from 'vscode';
import { ResolveTableDefinition } from '../../application/resolve-table-definition';
import { toVscodeLocation } from '../mappers';

export class TableDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private uc: ResolveTableDefinition) {}
  provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): vscode.Location[] {
    return this.uc.run(doc.getText(), doc.offsetAt(pos)).map(r => toVscodeLocation(r.location));
  }
}
```

- [ ] **Step 3: `extension.ts` 결선**

- import 추가: `ResolveTableDefinition`, `ListResolvedTableRefs`, `TableDefinitionProvider`
- 유즈케이스 생성: `resolveTbl`, `listResolvedTbl` (`store`를 리포지토리로 넘긴다 — `IndexStore`가 `getTable`을 노출한다)
- `ctx.subscriptions.push(...)`의 php 목록에 `vscode.languages.registerDefinitionProvider(php, new TableDefinitionProvider(resolveTbl))` 추가
- 하이라이트 소스 배열에 `{ setting: 'tables.highlightResolved', languages: ['php'], run: t => listResolvedTbl.run(t) }` 추가

`IndexStore`가 `TableRepository`를 그대로 만족하지 않으면(`getTable`·`allTableNames`만 필요) 기존 record 유즈케이스가 `store`를 어떻게 넘기는지 보고 같은 방식을 쓴다.

- [ ] **Step 4: 설정 기여 추가** — `package.json`의 `contributes.configuration.properties`

```json
"csmscode.tables.highlightResolved": {
  "type": "boolean",
  "default": true,
  "description": "해석되는 SQL 테이블 참조({table})를 링크 색상으로 하이라이팅"
}
```

- [ ] **Step 5: 검증**

Run: `npm run test:unit && npm run lint && npm run compile`
Expected: 전부 통과

- [ ] **Step 6: 커밋**

```bash
git add src/presentation/providers/table-definition-provider.ts src/extension.ts package.json test/unit/presentation
git commit -m "feat(presentation): 테이블 정의 프로바이더 + 하이라이트 소스 결선"
```

---

### Task 4: 루트 탐색 기본값 + 문서 + 버전

**Files:**
- Modify: `package.json` (`detectInSubfolders` 기본값, `version`)
- Modify: `README.md`, `CHANGELOG.md`, `docs/PHASE2-BACKLOG.md`, `docs/manual-verification.md`
- Test: `test/unit/infrastructure/moodle-root-resolver.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — 기본값이 바뀌는 것은 manifest 값이라 코드로는 검증되지 않는다. 대신 하위 폴더 탐색이 `version.php`만으로는 루트로 인정되지 않는다는 성질을 고정한다(기본값을 켜면서 오검출이 없어야 하는 근거).

```ts
  it('하위 폴더에 version.php만 있고 install.xml이 없으면 루트로 보지 않는다', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csms-root-'));
    fs.mkdirSync(path.join(tmp, 'moodle'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'moodle', 'version.php'), '<?php');
    assert.strictEqual(findMoodleRoot(tmp, ['moodle']), undefined);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
```
기존 테스트 파일의 픽스처 관례(`mini-moodle`·`mkdtempSync`)를 먼저 확인하고 그것에 맞춘다.

- [ ] **Step 2: 실패/통과 확인**

Run: `npm run test:unit -- --grep findMoodleRoot`
Expected: 이미 통과할 수 있다(기존 구현이 두 파일을 함께 확인). 통과하면 그대로 회귀 핀으로 남긴다.

- [ ] **Step 3: 기본값 변경** — `package.json`

`csmscode.detectInSubfolders`의 `"default": []` → `"default": ["moodle"]`, `description`에 기본값 근거를 한 줄로 적는다(“Moodle을 `moodle/` 하위에 두는 배치가 흔하므로 기본 포함”).

- [ ] **Step 4: 문서 갱신**

- `README.md`: 주요 기능에 "SQL 테이블 참조 이동" 한 줄, 설정 표에 `csmscode.tables.highlightResolved` 행 추가, `detectInSubfolders` 기본값 `["moodle"]`로 정정.
- `docs/manual-verification.md`: `{table}` F12·하이라이트 확인 절차 추가(단일 인용·heredoc 각 1회, 해석 안 되는 `{4}`에 아무 일도 없음).
- `docs/PHASE2-BACKLOG.md`: 새 항목으로 "테이블 hover", "`$DB` 메서드 인자 리터럴 이동", "install.xml → 사용처 참조(Shift+F12)"를 남긴다(이번 범위에서 제외된 것들). 실측치를 함께 적는다.
- `CHANGELOG.md`: `## [0.5.0] — 2026-08-06` 항목에 추가(기능)·변경(기본값)을 적는다.

- [ ] **Step 5: 버전 올리기** — `package.json`의 `version`을 `0.5.0`으로.

- [ ] **Step 6: 최종 검증**

Run: `npm run test:unit && npm run lint && npm run compile`
Expected: 전부 통과

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: SQL 테이블 이동 문서화 + 하위 폴더 탐색 기본값 + 0.5.0"
```
