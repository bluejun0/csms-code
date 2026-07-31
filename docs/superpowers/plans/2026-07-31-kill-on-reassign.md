# kill-on-reassign 추론 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 변수 재대입을 추적해 오래된 테이블 바인딩을 죽이고(kill), foreach 가림 버그를 함께 수정한다.

**Architecture:** 팩트 레이어에 모든 변수 LHS 대입을 캡처하는 `plainAssignments` 배열을 비파괴 확장으로 추가하고, 추론이 "가장 가까운 선행 이벤트 승리 + kill 가드" 규칙으로 레코드 대입/foreach를 병합 평가한다. phpdoc 절대 우선·dataarg 스코프 전역 폴백은 무변경.

**Tech Stack:** TypeScript (strict), web-tree-sitter 0.20.8 (tree-sitter-php WASM), mocha + ts-node.

**Spec:** `docs/superpowers/specs/2026-07-31-kill-on-reassign-design.md`

## Global Constraints

- 도메인 레이어(`src/domain/**`)는 vscode/infrastructure에 의존 금지 (eslint 계층 규칙이 강제함).
- tree-sitter 쿼리는 **인스턴스당 1회만 컴파일** (`create()`에서) — `facts()` 호출마다 재컴파일 금지 (WASM 힙 누수).
- `RecordTypeInference.infer()` 시그니처 무변경 — application/presentation 레이어는 손대지 않는다.
- 유닛 테스트: `npm run test:unit` (mocha, `.mocharc.json`이 ts-node 등록). 개별 파일: `npx mocha test/unit/<path>.test.ts`.
- 통합 테스트는 이 샌드박스에서 실행 불가(Electron SIGTRAP) — CI 몫. 이 계획에서는 다루지 않는다.
- 커밋 메시지: `feat|fix|docs(scope): 한국어 요약` (기존 히스토리 관례).

---

### Task 1: 팩트 스키마 + tree-sitter 일반 대입 추출

**Files:**
- Modify: `src/domain/code-analysis/facts.ts`
- Modify: `src/infrastructure/tree-sitter/tree-sitter-php-syntax.ts`
- Modify: `test/unit/domain/inference.test.ts:6` (base 리터럴에 필드 추가 — 컴파일 유지용, 테스트 로직 무변경)
- Test: `test/unit/infra/tree-sitter.test.ts`

**Interfaces:**
- Consumes: 기존 `Scope`, `DocumentFacts`, 어댑터의 `scopeOf`/`runMatches` 헬퍼.
- Produces: `PlainAssignment { varName: string; index: number; scope: Scope }` 인터페이스, `DocumentFacts.plainAssignments: PlainAssignment[]` 필드(필수), 어댑터가 모든 변수 LHS 대입을 이 배열로 채움. Task 2가 이 필드를 소비한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/unit/infra/tree-sitter.test.ts` 파일 끝에 추가:

```ts
// kill-on-reassign: 일반 대입(plainAssignments) 추출 (스펙 2026-07-31)
const CODE3 = `<?php
function process3() {
    $a = build_row();
    $b = new stdClass();
    $c = $other;
    $d = 42;
    $e = $obj->fetch();
    $rec = $DB->get_record('user', ['id' => 1]);
    $rec->prop = 1;
    $fn = function () { $inner = 1; };
}
`;

describe('TreeSitterPhpSyntax — plainAssignments (kill-on-reassign)', () => {
  let syn: TreeSitterPhpSyntax; let f: any;
  before(async () => { syn = await TreeSitterPhpSyntax.create(); f = syn.facts(CODE3); });

  it('RHS 종류 무관 전부 캡처: func()/new/변수/리터럴/메서드콜', () => {
    for (const v of ['a', 'b', 'c', 'd', 'e']) {
      assert.ok(f.plainAssignments.some((x: any) => x.varName === v), `$${v} 캡처되어야 함`);
    }
  });
  it('프로퍼티 쓰기($rec->prop = 1)는 캡처하지 않음', () => {
    assert.ok(!f.plainAssignments.some((x: any) => x.varName === 'prop'));
    assert.equal(f.plainAssignments.filter((x: any) => x.varName === 'rec').length, 1,
      '$rec는 get_record 대입 1건만(프로퍼티 쓰기 줄은 제외)');
  });
  it('레코드 대입도 plainAssignments에 같은 index로 존재', () => {
    const ra = f.assignments.find((x: any) => x.varName === 'rec');
    assert.ok(f.plainAssignments.some((x: any) => x.varName === 'rec' && x.index === ra.index));
  });
  it('클로저 내부 대입의 scope는 클로저(외부와 분리)', () => {
    const inner = f.plainAssignments.find((x: any) => x.varName === 'inner');
    const outer = f.plainAssignments.find((x: any) => x.varName === 'a');
    assert.ok(inner, '$inner 캡처되어야 함');
    assert.ok(inner.scope.start > outer.scope.start, '클로저 scope가 함수 scope보다 안쪽이어야 함');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx mocha test/unit/infra/tree-sitter.test.ts`
Expected: FAIL — `f.plainAssignments`가 undefined라 `TypeError` 또는 assert 실패. (이 시점엔 facts.ts 미수정이라 ts-node 컴파일은 통과하고 런타임 실패한다 — `f`는 `any`.)

- [ ] **Step 3: 팩트 스키마 확장**

`src/domain/code-analysis/facts.ts` — `PhpdocVar` 선언 다음 줄에 추가하고 `DocumentFacts`에 필드 추가:

```ts
export interface PlainAssignment { varName: string; index: number; scope: Scope; }
```

`DocumentFacts`는 다음과 같이 된다:

```ts
export interface DocumentFacts {
  assignments: RecordAssignment[];
  foreachBindings: ForeachBinding[];
  dataArgBindings: DataArgBinding[];
  phpdocVars: PhpdocVar[];
  propertyAccesses: PropertyAccess[];
  plainAssignments: PlainAssignment[];
}
```

`test/unit/domain/inference.test.ts:6`의 base 리터럴에 필드 추가(컴파일 유지, 기존 테스트 의미 무변경):

```ts
const base: DocumentFacts = { assignments: [], foreachBindings: [], dataArgBindings: [], phpdocVars: [], propertyAccesses: [], plainAssignments: [] };
```

- [ ] **Step 4: 어댑터에 쿼리 추가 + 추출**

`src/infrastructure/tree-sitter/tree-sitter-php-syntax.ts`:

1. import에 `PlainAssignment` 추가:
```ts
import {
  DocumentFacts, RecordAssignment, ForeachBinding, DataArgBinding, PhpdocVar, PlainAssignment, PropertyAccess, Scope,
} from '../../domain/code-analysis/facts';
```

2. `Q_DATAARG` 선언 아래에 쿼리 추가 — LHS가 단순 변수인 모든 대입. 프로퍼티 쓰기(`$x->p = …`)는 LHS가 `member_access_expression`이라 매칭되지 않고, 구조 분해(`[$a,$b] = …`)도 매칭되지 않는다(스펙 §1 비목표):
```ts
// kill-on-reassign: LHS가 단순 변수인 모든 대입(RHS 무관). 레코드 대입도 포함된다(추론이 index 동일성으로 처리).
const Q_PLAIN_ASSIGN = `
  (assignment_expression left: (variable_name (name) @var))`;
```

3. `CompiledQueries`에 `plainAssign: Parser.Query;` 필드 추가, `create()`의 queries 객체에 `plainAssign: lang.query(Q_PLAIN_ASSIGN),` 추가.

4. `facts()` 안에서 `dataArgBindings` 블록 다음에 추출 추가:
```ts
const plainAssignments: PlainAssignment[] = [];
for (const { caps } of runMatches(this.queries.plainAssign)) {
  const varN = caps.get('var')!;
  plainAssignments.push({ varName: varN.text, index: varN.startIndex, scope: scopeOf(varN) });
}
```

5. 반환 객체에 `plainAssignments` 추가:
```ts
return { assignments, foreachBindings, dataArgBindings, phpdocVars, propertyAccesses, plainAssignments };
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx mocha test/unit/infra/tree-sitter.test.ts`
Expected: PASS — 신규 4건 포함 전부 녹색.

- [ ] **Step 6: 전체 유닛 + 타입 체크로 회귀 확인**

Run: `npm run test:unit && npx tsc -noEmit && npx tsc -p tsconfig.test.json`
Expected: 전부 통과 (기존 테스트 무회귀, `DocumentFacts` 생성처 2곳 모두 갱신됨).

- [ ] **Step 7: Commit**

```bash
git add src/domain/code-analysis/facts.ts src/infrastructure/tree-sitter/tree-sitter-php-syntax.ts test/unit/infra/tree-sitter.test.ts test/unit/domain/inference.test.ts
git commit -m "feat(infra): 모든 변수 LHS 대입 캡처(plainAssignments) — kill-on-reassign 준비"
```

---

### Task 2: 추론 kill 가드 + 레코드 대입/foreach 병합

**Files:**
- Modify: `src/domain/code-analysis/record-type-inference.ts`
- Test: `test/unit/domain/inference.test.ts`

**Interfaces:**
- Consumes: Task 1의 `DocumentFacts.plainAssignments: PlainAssignment[]`, 기존 `ForeachBinding`(`facts.ts`에 이미 존재: `{ collectionVar; itemVar; index; scope }`).
- Produces: `infer(facts, varName, atIndex, scope, tableExists): RecordBinding | null` — **시그니처·`RecordBinding`·`BindingSource` 무변경**, 동작만 스펙 §2 규칙으로.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/unit/domain/inference.test.ts`의 `describe('RecordTypeInference', …)` 블록 안, 마지막 `it` 뒤에 추가 (스펙 §4 도메인 8건):

```ts
  // ---- kill-on-reassign (스펙 2026-07-31) ----
  it('kill: 레코드 대입 후 일반 재대입 → null (대표 오탐 시나리오)', () => {
    const f = { ...base,
      assignments: [{ varName: 'rec', receiver: 'DB', method: 'get_record', tableArg: 'user', index: 10, scope: S }],
      plainAssignments: [{ varName: 'rec', index: 10, scope: S }, { varName: 'rec', index: 30, scope: S }] };
    assert.equal(inf.infer(f, 'rec', 50, S, known), null);
  });
  it('kill 후 재차 레코드 대입 → 재바인딩', () => {
    const f = { ...base,
      assignments: [
        { varName: 'rec', receiver: 'DB', method: 'get_record', tableArg: 'user', index: 10, scope: S },
        { varName: 'rec', receiver: 'DB', method: 'get_record', tableArg: 'assign', index: 40, scope: S }],
      plainAssignments: [
        { varName: 'rec', index: 10, scope: S }, { varName: 'rec', index: 30, scope: S }, { varName: 'rec', index: 40, scope: S }] };
    assert.deepEqual(inf.infer(f, 'rec', 60, S, known), { varName: 'rec', tableName: 'assign', source: 'assignment' });
  });
  it('foreach 항목이 앞선 레코드 대입보다 가까우면 foreach 승리(가림 버그 수정)', () => {
    const f = { ...base,
      assignments: [
        { varName: 'r', receiver: 'DB', method: 'get_record', tableArg: 'user', index: 10, scope: S },
        { varName: 'rows', receiver: 'DB', method: 'get_records', tableArg: 'local_ubattend_log', index: 20, scope: S }],
      foreachBindings: [{ collectionVar: 'rows', itemVar: 'r', index: 30, scope: S }],
      plainAssignments: [{ varName: 'r', index: 10, scope: S }, { varName: 'rows', index: 20, scope: S }] };
    assert.deepEqual(inf.infer(f, 'r', 50, S, known), { varName: 'r', tableName: 'local_ubattend_log', source: 'foreach' });
  });
  it('foreach 항목 사용 후 재대입 → kill', () => {
    const f = { ...base,
      assignments: [{ varName: 'rows', receiver: 'DB', method: 'get_records', tableArg: 'user', index: 10, scope: S }],
      foreachBindings: [{ collectionVar: 'rows', itemVar: 'r', index: 20, scope: S }],
      plainAssignments: [{ varName: 'rows', index: 10, scope: S }, { varName: 'r', index: 40, scope: S }] };
    assert.equal(inf.infer(f, 'r', 60, S, known), null);
  });
  it('phpdoc @var은 후속 일반 대입에도 생존(절대 우선)', () => {
    const f = { ...base,
      phpdocVars: [{ varName: 'rec', typeText: 'user', index: 5, scope: S }],
      plainAssignments: [{ varName: 'rec', index: 10, scope: S }] };
    assert.equal(inf.infer(f, 'rec', 50, S, known)!.source, 'phpdoc');
  });
  it('dataarg는 new stdClass kill에도 생존', () => {
    const f = { ...base,
      plainAssignments: [{ varName: 'data', index: 10, scope: S }],
      dataArgBindings: [{ method: 'insert_record', tableArg: 'local_ubattend_config', dataVar: 'data', index: 90, scope: S }] };
    assert.deepEqual(inf.infer(f, 'data', 50, S, known), { varName: 'data', tableName: 'local_ubattend_config', source: 'dataarg' });
  });
  it('컬렉션 재대입 후 foreach → 항목 바인딩 없음', () => {
    const f = { ...base,
      assignments: [{ varName: 'rows', receiver: 'DB', method: 'get_records', tableArg: 'user', index: 10, scope: S }],
      foreachBindings: [{ collectionVar: 'rows', itemVar: 'r', index: 40, scope: S }],
      plainAssignments: [{ varName: 'rows', index: 10, scope: S }, { varName: 'rows', index: 20, scope: S }] };
    assert.equal(inf.infer(f, 'r', 60, S, known), null);
  });
  it('다른 스코프의 일반 대입은 kill 아님(sameScope 가드)', () => {
    const scopeA = { start: 0, end: 100 }; const scopeB = { start: 200, end: 300 };
    const f = { ...base,
      assignments: [{ varName: 'rec', receiver: 'DB', method: 'get_record', tableArg: 'user', index: 10, scope: scopeA }],
      plainAssignments: [{ varName: 'rec', index: 10, scope: scopeA }, { varName: 'rec', index: 250, scope: scopeB }] };
    assert.deepEqual(inf.infer(f, 'rec', 50, scopeA, known), { varName: 'rec', tableName: 'user', source: 'assignment' });
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx mocha test/unit/domain/inference.test.ts`
Expected: 신규 8건 중 **kill/foreach 승리/컬렉션 재대입 관련 4건 FAIL** (기존 로직은 재대입을 모름). phpdoc 생존·dataarg 생존·재바인딩·크로스 스코프 4건은 기존 로직으로도 우연히 통과할 수 있다 — 실패 4건이 정확히 kill 미구현 때문인지 확인.

- [ ] **Step 3: 추론 구현**

`src/domain/code-analysis/record-type-inference.ts` 전체를 다음으로 교체:

```ts
import { DocumentFacts, ForeachBinding, Scope } from './facts';

export type BindingSource = 'phpdoc' | 'assignment' | 'foreach' | 'dataarg';
export interface RecordBinding { varName: string; tableName: string; source: BindingSource; }

const RECORD_METHODS = new Set([
  'get_record', 'get_record_select', 'get_records', 'get_records_select',
  'get_recordset', 'get_recordset_select',
]);

function sameScope(a: Scope, b: Scope): boolean { return a.start === b.start && a.end === b.end; }

export class RecordTypeInference {
  infer(facts: DocumentFacts, varName: string, atIndex: number, scope: Scope,
        tableExists: (t: string) => boolean): RecordBinding | null {

    // ① phpdoc: 절대 우선 — 오탐 회피 수단(@var)이 자기 다음 대입에 죽지 않도록 위치 비교에 불참
    const doc = nearestPreceding(
      facts.phpdocVars.filter(v => v.varName === varName && sameScope(v.scope, scope)), atIndex);
    if (doc) {
      const t = stripType(doc.typeText);
      if (tableExists(t)) return { varName, tableName: t, source: 'phpdoc' };
      // bare stdClass 등 → 폴백(아래로)
    }

    // kill 기준: 종류 무관 가장 가까운 일반 대입 — 이보다 오래된 바인딩 이벤트는 죽는다
    const kill = nearestPreceding(
      facts.plainAssignments.filter(p => p.varName === varName && sameScope(p.scope, scope)), atIndex);

    // ②+③ 병합: 레코드 대입 vs foreach 중 더 가까운 이벤트가 승리
    const asg = nearestPreceding(
      facts.assignments.filter(a => a.varName === varName && sameScope(a.scope, scope)
        && RECORD_METHODS.has(a.method) && a.tableArg && tableExists(a.tableArg)), atIndex);
    const fe = nearestPreceding(
      facts.foreachBindings.filter(b => b.itemVar === varName && sameScope(b.scope, scope)), atIndex);

    if (asg && (!fe || asg.index > fe.index)) {
      // 레코드 대입은 자신도 일반 대입(같은 index)이므로 >= 로 자연 통과
      if (!kill || asg.index >= kill.index) {
        return { varName, tableName: asg.tableArg!, source: 'assignment' };
      }
    } else if (fe && (!kill || fe.index >= kill.index)) {
      const table = resolveCollection(facts, fe, scope, tableExists);
      if (table) return { varName, tableName: table, source: 'foreach' };
    }

    // ④ dataarg: 스코프 전역 유지 — $data = new stdClass(); … insert_record('tbl', $data)
    // 패턴에서 new stdClass 대입이 kill이어도 dataarg가 되살리는 것이 의도된 동작.
    // 동일 변수명이 서로 다른 테이블에 바인딩되면 null(오탐 방지) — 단일 테이블로 귀결될 때만 바인딩.
    const daMatches = facts.dataArgBindings.filter(d =>
      d.dataVar === varName && sameScope(d.scope, scope) && tableExists(d.tableArg));
    if (daMatches.length > 0) {
      const distinctTables = new Set(daMatches.map(d => d.tableArg));
      if (distinctTables.size === 1) return { varName, tableName: daMatches[0].tableArg, source: 'dataarg' };
      return null;
    }

    return null;
  }
}

/** foreach 컬렉션 변수를 fe 시점 기준으로 해석 — 컬렉션 변수에도 동일한 kill 가드 적용 */
function resolveCollection(facts: DocumentFacts, fe: ForeachBinding, scope: Scope,
                           tableExists: (t: string) => boolean): string | null {
  const collAsg = nearestPreceding(
    facts.assignments.filter(a => a.varName === fe.collectionVar && sameScope(a.scope, scope)
      && RECORD_METHODS.has(a.method) && a.tableArg && tableExists(a.tableArg)), fe.index);
  if (!collAsg) return null;
  const collKill = nearestPreceding(
    facts.plainAssignments.filter(p => p.varName === fe.collectionVar && sameScope(p.scope, scope)), fe.index);
  if (collKill && collKill.index > collAsg.index) return null;
  return collAsg.tableArg!;
}

function nearestPreceding<T extends { index: number }>(items: T[], atIndex: number): T | undefined {
  let best: T | undefined;
  for (const it of items) if (it.index <= atIndex && (!best || it.index > best.index)) best = it;
  return best;
}

/** `\stdClass` / `stdClass` / `?table` 등에서 마지막 식별자만 */
function stripType(t: string): string {
  return t.replace(/^[?\\]+/, '').split('\\').pop() ?? t;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx mocha test/unit/domain/inference.test.ts`
Expected: PASS — 기존 9건 + 신규 8건 전부 녹색. 특히 기존 `foreach: 컬렉션 테이블 → 항목 바인딩`·`dataarg` 3건이 그대로 통과해야 한다(회귀 감지 지점).

- [ ] **Step 5: 전체 유닛으로 엔드투엔드 회귀 확인**

Run: `npm run test:unit`
Expected: 전부 통과. `usecases.test.ts`(실제 tree-sitter로 진단 생성)가 신규 팩트+추론 조합의 통합 지점이다 — 레코드 대입이 plainAssignments에도 잡히지만 같은 index라 바인딩이 유지되는지 여기서 실증된다.

- [ ] **Step 6: Commit**

```bash
git add src/domain/code-analysis/record-type-inference.ts test/unit/domain/inference.test.ts
git commit -m "feat(domain): kill-on-reassign 추론 — 재대입 오탐 제거 + foreach 가림 수정"
```

---

### Task 3: 백로그 문서 갱신 + 최종 검증

**Files:**
- Modify: `docs/PHASE2-BACKLOG.md`

**Interfaces:**
- Consumes: Task 1·2의 완료 상태 (코드 변경 없음).
- Produces: 갱신된 백로그 문서 — 이후 세션이 "재대입 오탐"을 이미 해결된 것으로 인식한다.

- [ ] **Step 1: 알려진 제한 섹션 교체**

`docs/PHASE2-BACKLOG.md`의 "## 알려진 제한 (Phase 1)" 아래 `**재대입 미추적 → 드문 오탐**` 불릿 전체를 다음 두 불릿으로 교체:

```markdown
- **구조 분해·복합 대입 미추적**: kill-on-reassign(2026-07-31)은 단순 변수 LHS 대입만 캡처한다. `[$a, $b] = …`, `+=`, `??=` 등은 캡처되지 않아 이전 바인딩이 유지된다(낙관 동작, 실코드에서 레코드 변수에 드묾).
- **dataarg 위치 무관**: insert/update 힌트는 스코프 전역이라 재대입과 무관하게 폴백으로 평가된다(다중 테이블 모호 시 null 가드 유지). `new stdClass` 후 insert 패턴 보존을 위한 의도된 동작.
```

- [ ] **Step 2: 백로그 1번 완료 표시**

"## Phase 2 후속 작업 (우선순위 순)"의 1번 항목을 다음으로 교체 (번호 유지, 나머지 항목 무변경):

```markdown
1. ~~**kill-on-reassign 추론**~~ — ✅ 완료 (2026-07-31, 설계: `docs/superpowers/specs/2026-07-31-kill-on-reassign-design.md`). 재대입 오탐 제거 + foreach 가림 버그 수정.
```

- [ ] **Step 3: 최종 전체 검증**

Run: `npm run test:unit && npm run lint && npm run compile && npx tsc -p tsconfig.test.json`
Expected: 전부 통과 — 유닛(기존+신규 12건), eslint 계층 규칙, 프로덕션 번들 빌드, 테스트 컴파일.

- [ ] **Step 4: Commit**

```bash
git add docs/PHASE2-BACKLOG.md
git commit -m "docs: kill-on-reassign 완료 반영 — 알려진 제한 갱신"
```
