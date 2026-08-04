# 컬렉션 직접 바인딩 제거 + 스코프 정밀화 + 폴리시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 배열/recordset 변수에 뜨던 잘못된 컬럼 바인딩을 제거하고(직접 바인딩은 단일 레코드 메서드로만), 클로저 스코프 누수를 수정하며, debounce 리뷰 폴리시 3건을 반영한다.

**Architecture:** `RECORD_METHODS` 단일 집합을 `DIRECT_RECORD_METHODS`(② 직접 대입)와 `COLLECTION_METHODS`(③ foreach 컬렉션 해석)로 분리. `scopeContaining()` 후보에 `plainAssignments` 추가. 진단 변경 핸들러에 php/file 가드 선행 + disposable 순서 정리. 시그니처·팩트 스키마 무변경.

**Tech Stack:** TypeScript (strict), mocha + ts-node.

**Spec:** `docs/superpowers/specs/2026-08-04-recordset-scope-polish-design.md`

## Global Constraints

- `infer()` 시그니처·`RecordBinding`·`BindingSource`·팩트 스키마 무변경.
- kill 가드·phpdoc 절대 우선·dataarg 폴백 로직 무변경 — 바뀌는 것은 두 메서드 집합 필터뿐.
- `refresh` 함수 본문 무변경 — 내부 가드(scheme/languageId)는 다른 호출 경로 보호를 위해 유지.
- 유닛 테스트: `npm run test:unit`. 개별 파일: `npx mocha test/unit/<path>.test.ts`.
- 커밋 메시지: `feat|fix|docs(scope): 한국어 요약`.

---

### Task 1: 메서드 집합 분리 — 컬렉션 직접 바인딩 제거

**Files:**
- Modify: `src/domain/code-analysis/record-type-inference.ts`
- Test: `test/unit/domain/inference.test.ts`

**Interfaces:**
- Consumes: 기존 `DocumentFacts`(무변경).
- Produces: 동작 변경만 — `DIRECT_RECORD_METHODS = {get_record, get_record_select}`가 ② 직접 대입 필터, `COLLECTION_METHODS = {get_records, get_records_select, get_recordset, get_recordset_select}`가 `resolveCollection` 필터. Task 2·3은 이 집합에 의존하지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/unit/domain/inference.test.ts`의 `describe('RecordTypeInference', …)` 블록 마지막에 추가:

```ts
  // ---- 컬렉션 직접 바인딩 제거 (스펙 2026-08-04) ----
  it('get_recordset 직접 대입 → null (recordset 객체는 레코드가 아님)', () => {
    const f = { ...base,
      assignments: [{ varName: 'rs', receiver: 'DB', method: 'get_recordset', tableArg: 'user', index: 10, scope: S }],
      plainAssignments: [{ varName: 'rs', index: 10, scope: S }] };
    assert.equal(inf.infer(f, 'rs', 50, S, known), null);
  });
  it('get_recordset_select 직접 대입 → null', () => {
    const f = { ...base,
      assignments: [{ varName: 'rs', receiver: 'DB', method: 'get_recordset_select', tableArg: 'user', index: 10, scope: S }],
      plainAssignments: [{ varName: 'rs', index: 10, scope: S }] };
    assert.equal(inf.infer(f, 'rs', 50, S, known), null);
  });
  it('get_records 직접 대입 → null (배열 변수는 레코드가 아님)', () => {
    const f = { ...base,
      assignments: [{ varName: 'rows', receiver: 'DB', method: 'get_records', tableArg: 'user', index: 10, scope: S }],
      plainAssignments: [{ varName: 'rows', index: 10, scope: S }] };
    assert.equal(inf.infer(f, 'rows', 50, S, known), null);
  });
  it('foreach over get_recordset → 항목은 바인딩', () => {
    const f = { ...base,
      assignments: [{ varName: 'rs', receiver: 'DB', method: 'get_recordset', tableArg: 'local_ubattend_log', index: 10, scope: S }],
      foreachBindings: [{ collectionVar: 'rs', itemVar: 'r', index: 20, scope: S }],
      plainAssignments: [{ varName: 'rs', index: 10, scope: S }] };
    assert.deepEqual(inf.infer(f, 'r', 50, S, known), { varName: 'r', tableName: 'local_ubattend_log', source: 'foreach' });
  });
  it('foreach over get_record(단일 레코드) → 항목 바인딩 없음 (필드 값 순회)', () => {
    const f = { ...base,
      assignments: [{ varName: 'rec', receiver: 'DB', method: 'get_record', tableArg: 'user', index: 10, scope: S }],
      foreachBindings: [{ collectionVar: 'rec', itemVar: 'v', index: 20, scope: S }],
      plainAssignments: [{ varName: 'rec', index: 10, scope: S }] };
    assert.equal(inf.infer(f, 'v', 50, S, known), null);
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx mocha test/unit/domain/inference.test.ts`
Expected: 신규 5건 중 **4건 FAIL** (recordset/recordset_select/get_records 직접 3건은 바인딩이 반환되고, foreach-단일-레코드 1건도 바인딩 반환). `foreach over get_recordset → 항목은 바인딩` 1건은 기존 로직으로도 통과. 실패가 정확히 이 4건인지 확인.

- [ ] **Step 3: 구현**

`src/domain/code-analysis/record-type-inference.ts`에서 세 군데 수정:

1. `RECORD_METHODS` 선언(6-9행)을 다음 두 집합으로 교체:
```ts
// 단일 stdClass 레코드 반환 → 변수 자체에 컬럼 바인딩 (② 직접 대입 경로)
const DIRECT_RECORD_METHODS = new Set(['get_record', 'get_record_select']);
// 레코드 컬렉션 반환 → foreach 항목 변수에만 바인딩 — 배열/recordset 변수 자체는 레코드가 아님 (스펙 2026-08-04)
const COLLECTION_METHODS = new Set(['get_records', 'get_records_select', 'get_recordset', 'get_recordset_select']);
```

2. `infer()`의 ② 필터에서 `RECORD_METHODS.has(a.method)` → `DIRECT_RECORD_METHODS.has(a.method)`.

3. `resolveCollection()`의 필터에서 `RECORD_METHODS.has(a.method)` → `COLLECTION_METHODS.has(a.method)`.

(kill 가드·phpdoc·dataarg 및 다른 코드는 무변경.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx mocha test/unit/domain/inference.test.ts`
Expected: PASS — 기존 17건 + 신규 5건 = 22건 전부 녹색. 특히 기존 `get_record 대입 → 테이블 바인딩`(직접 유지)과 `foreach: 컬렉션 테이블 → 항목 바인딩`(get_records 컬렉션 유지)이 회귀 감지 지점.

- [ ] **Step 5: 전체 회귀 확인**

Run: `npm run test:unit && npx tsc -noEmit`
Expected: 72건 전부 통과(67 + 5).

- [ ] **Step 6: Commit**

```bash
git add src/domain/code-analysis/record-type-inference.ts test/unit/domain/inference.test.ts
git commit -m "fix(domain): 컬렉션 직접 바인딩 제거 — 배열/recordset 변수는 레코드가 아님"
```

---

### Task 2: scopeContaining에 plainAssignments 반영 — 클로저 누수 수정

**Files:**
- Modify: `src/application/complete-record-columns.ts`
- Test: `test/unit/application/usecases.test.ts`

**Interfaces:**
- Consumes: `DocumentFacts.plainAssignments`(기존), `CompleteRecordColumns.run(text, varName, atIndex): ColumnItem[]`(무변경).
- Produces: 동작 변경만 — 일반 대입만 있는 클로저가 스코프 축소에 보인다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/unit/application/usecases.test.ts`에 import 추가:
```ts
import { CompleteRecordColumns } from '../../../src/application/complete-record-columns';
```

파일 끝에 추가:
```ts
// scopeContaining 클로저 정밀화 (스펙 2026-08-04): 일반 대입만 있는 클로저가
// 스코프 축소에 보여야 바깥 바인딩이 클로저 안 완성으로 새지 않는다.
const CODE2 = `<?php
function g() {
  $c = $DB->get_record('local_ubattend_config', ['id' => 1]);
  echo $c->courseid;
  $fn = function () {
    $tmp = 1;
  };
}
`;

describe('CompleteRecordColumns — scopeContaining 클로저 정밀화', () => {
  it('일반 대입만 있는 클로저 내부 → 바깥 바인딩이 새지 않음([])', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const uc = new CompleteRecordColumns(syn, repo, new RecordTypeInference());
    const atInsideClosure = CODE2.indexOf('$tmp');
    assert.deepEqual(uc.run(CODE2, 'c', atInsideClosure), []);
  });
  it('양성 대조: 바깥 함수 위치에서는 컬럼 3개(정상 완성 무회귀)', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const uc = new CompleteRecordColumns(syn, repo, new RecordTypeInference());
    const atOuter = CODE2.indexOf('$c->courseid');
    assert.equal(uc.run(CODE2, 'c', atOuter).length, 3);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx mocha test/unit/application/usecases.test.ts`
Expected: 클로저 테스트 1건 FAIL — 수정 전에는 `$tmp = 1`(plainAssignment)이 스코프 후보에 없어 스코프가 바깥 함수 `g`로 폴백하고, `$c` 바인딩이 성립해 컬럼 3개가 반환된다(`[]`가 아님). 양성 대조 1건은 통과.

- [ ] **Step 3: 구현**

`src/application/complete-record-columns.ts`의 `scopeContaining` 함수에서 인라인 타입과 스프레드에 `plainAssignments` 추가 — 함수 전체를 다음으로 교체:

```ts
// 커서 위치를 포함하는 가장 좁은 팩트 스코프(없으면 전체)
function scopeContaining(facts: { assignments: {scope:Scope}[]; propertyAccesses: {scope:Scope}[]; foreachBindings:{scope:Scope}[]; dataArgBindings:{scope:Scope}[]; phpdocVars:{scope:Scope}[]; plainAssignments:{scope:Scope}[] }, atIndex: number): Scope {
  let best: Scope = { start: 0, end: Number.MAX_SAFE_INTEGER };
  const all = [...facts.assignments, ...facts.propertyAccesses, ...facts.foreachBindings, ...facts.dataArgBindings, ...facts.phpdocVars, ...facts.plainAssignments];
  for (const { scope } of all)
    if (scope.start <= atIndex && atIndex <= scope.end && (scope.end - scope.start) < (best.end - best.start)) best = scope;
  return best;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx mocha test/unit/application/usecases.test.ts`
Expected: PASS — 기존 1건 + 신규 2건 전부 녹색.

- [ ] **Step 5: 전체 회귀 확인**

Run: `npm run test:unit && npx tsc -noEmit`
Expected: 74건 전부 통과(72 + 2).

- [ ] **Step 6: Commit**

```bash
git add src/application/complete-record-columns.ts test/unit/application/usecases.test.ts
git commit -m "fix(app): scopeContaining이 plainAssignments 인식 — 클로저 바깥 바인딩 누수 수정"
```

---

### Task 3: 진단 결선 폴리시 + 문서 갱신 + 최종 검증

**Files:**
- Modify: `src/presentation/providers/record-diagnostics.ts`
- Modify: `src/infrastructure/caching/cached-php-syntax.ts` (주석 1줄)
- Modify: `docs/PHASE2-BACKLOG.md`

**Interfaces:**
- Consumes: `KeyedDebouncer`(dispose(): void — 구조적으로 vscode.Disposable 충족).
- Produces: 동작 변경 — 비 php/file 문서 변경은 타이머를 만들지 않음. 처분 순서 명시화(debouncer 먼저).

- [ ] **Step 1: 변경 핸들러 가드 선행 + 처분 순서 정리**

`src/presentation/providers/record-diagnostics.ts`에서 두 군데 수정 (`refresh` 본문 무변경):

1. 처분 등록(현재 `ctx.subscriptions.push(coll, { dispose: () => debouncer.dispose() });`)을 다음으로 교체 — debouncer가 collection보다 먼저 처분되도록, 래퍼 없이 직접 등록:
```ts
  ctx.subscriptions.push(debouncer, coll);
```

2. 변경 핸들러(현재 `vscode.workspace.onDidChangeTextDocument(e => debouncer.schedule(e.document.uri.toString(), () => refresh(e.document))),`)를 다음으로 교체:
```ts
    vscode.workspace.onDidChangeTextDocument(e => {
      // 가드 선행: 출력 채널 등 비대상 문서의 변경마다 타이머를 만들었다 지우는 churn 방지
      // (refresh 내부의 동일 가드는 다른 호출 경로 보호용으로 유지)
      if (e.document.languageId !== 'php' || e.document.uri.scheme !== 'file') return;
      debouncer.schedule(e.document.uri.toString(), () => refresh(e.document));
    }),
```

- [ ] **Step 2: 캐시 메모리 주석 추가**

`src/infrastructure/caching/cached-php-syntax.ts`의 클래스 doc 주석 마지막 줄(` *  반환 객체는 히트 간 공유된다 — 호출자는 팩트를 변형하지 않는다(기존 관례). */`)을 다음 두 줄로 교체:
```ts
 *  반환 객체는 히트 간 공유된다 — 호출자는 팩트를 변형하지 않는다(기존 관례).
 *  메모리 상한: capacity × 최대 문서 텍스트(키) + 팩트 배열 — 기본 8이면 대형 Moodle lib(~800KB) 기준 수 MB. */
```

- [ ] **Step 3: 백로그 3번·11번 완료 표시**

`docs/PHASE2-BACKLOG.md`에서:

(a) 3번 항목(`3. **\`get_recordset\` 직접 바인딩 제거**: …` 한 줄)을 다음으로 교체:
```markdown
3. ~~**`get_recordset` 직접 바인딩 제거**~~ — ✅ 완료 (2026-08-04, 설계: `docs/superpowers/specs/2026-08-04-recordset-scope-polish-design.md`). get_records(배열)까지 넓혀 직접 바인딩은 단일 레코드 메서드(get_record/get_record_select)로만 한정.
```

(b) 11번 항목(`11. **\`scopeContaining()\`에 plainAssignments 반영**: …` 한 줄)을 다음으로 교체:
```markdown
11. ~~**`scopeContaining()`에 plainAssignments 반영**~~ — ✅ 완료 (2026-08-04, 같은 설계 문서). 일반 대입만 있는 클로저의 바깥 바인딩 누수 수정.
```

- [ ] **Step 4: 최종 전체 검증**

Run: `npm run test:unit && npm run lint && npm run compile && npx tsc -p tsconfig.test.json`
Expected: 전부 통과 — 유닛 74건(67 기존 + 5 도메인 + 2 애플리케이션), eslint, 프로덕션 번들, 테스트 컴파일. 특히 `tsc -noEmit`(compile 스크립트에 포함)이 `push(debouncer, coll)`의 Disposable 구조 호환을 보증.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/providers/record-diagnostics.ts src/infrastructure/caching/cached-php-syntax.ts docs/PHASE2-BACKLOG.md
git commit -m "fix(presentation): 진단 변경 핸들러 가드 선행·처분 순서 정리 — 백로그 3·11 완료 반영"
```
