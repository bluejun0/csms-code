# 진단 debounce + 팩트 캐시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** keystroke마다 문서 전체를 재파싱하는 진단을 300ms debounce로 완화하고, 동일 텍스트 중복 파싱을 LRU 팩트 캐시로 제거한다.

**Architecture:** `CachedPhpSyntax`(infrastructure, `PhpSyntax` 데코레이터)가 텍스트 내용을 키로 `DocumentFacts`를 LRU 캐시하고, 컴포지션 루트에서 한 줄 랩핑으로 유즈케이스 4개가 자동 공유한다. `KeyedDebouncer`(presentation, vscode 무의존)가 문서별 진단 refresh를 300ms 지연시킨다. 포트·유즈케이스·프로바이더 시그니처 무변경.

**Tech Stack:** TypeScript (strict), mocha + ts-node (실제 타이머로 debounce 테스트).

**Spec:** `docs/superpowers/specs/2026-08-04-diagnostics-debounce-facts-cache-design.md`

## Global Constraints

- 포트(`PhpSyntax`)·유즈케이스 4개·프로바이더 시그니처 무변경 — 캐시는 데코레이터로만.
- `KeyedDebouncer`는 vscode를 import하지 않는다 (유닛 테스트 가능해야 함).
- 캐시 반환 객체는 히트 간 공유 — 호출자가 팩트를 변형하지 않는 기존 관례 유지(변형 코드 추가 금지).
- 열림(onDidOpen)·초기 스캔·설정 토글은 **즉시** refresh 유지 — debounce는 `onDidChangeTextDocument`에만.
- 문서 close 시 해당 uri의 대기 타이머를 취소해야 한다(닫힌 문서 진단 부활 누수 방지).
- 유닛 테스트: `npm run test:unit`. 개별 파일: `npx mocha test/unit/<path>.test.ts`.
- 커밋 메시지: `feat|fix|docs(scope): 한국어 요약`.

---

### Task 1: CachedPhpSyntax — LRU 팩트 캐시 + 컴포지션 루트 결선

**Files:**
- Create: `src/infrastructure/caching/cached-php-syntax.ts`
- Modify: `src/extension.ts` (syntax 랩핑 + import)
- Test: `test/unit/infra/cached-php-syntax.test.ts`

**Interfaces:**
- Consumes: `PhpSyntax { facts(text: string): DocumentFacts }` (`src/domain/code-analysis/ports/php-syntax.ts`), `DocumentFacts` (`src/domain/code-analysis/facts.ts` — 6개 배열 필드: assignments, foreachBindings, dataArgBindings, phpdocVars, propertyAccesses, plainAssignments).
- Produces: `CachedPhpSyntax implements PhpSyntax`, 생성자 `(inner: PhpSyntax, capacity = 8)`. Task 2·3은 이 클래스에 의존하지 않는다(독립).

- [ ] **Step 1: 실패하는 테스트 작성**

`test/unit/infra/cached-php-syntax.test.ts` 신규 생성:

```ts
import { strict as assert } from 'assert';
import { CachedPhpSyntax } from '../../../src/infrastructure/caching/cached-php-syntax';
import { DocumentFacts } from '../../../src/domain/code-analysis/facts';
import { PhpSyntax } from '../../../src/domain/code-analysis/ports/php-syntax';

/** 파싱 호출 횟수를 세는 가짜 — 매 호출 새 객체를 반환하므로 동일 객체 단언이 캐시 히트를 증명한다 */
class CountingFake implements PhpSyntax {
  calls = 0;
  facts(_text: string): DocumentFacts {
    this.calls++;
    return { assignments: [], foreachBindings: [], dataArgBindings: [], phpdocVars: [], propertyAccesses: [], plainAssignments: [] };
  }
}

describe('CachedPhpSyntax', () => {
  it('동일 텍스트 2회 → 파싱 1회 + 동일 객체 반환', () => {
    const fake = new CountingFake();
    const c = new CachedPhpSyntax(fake, 8);
    const a = c.facts('<?php $a = 1;');
    const b = c.facts('<?php $a = 1;');
    assert.equal(fake.calls, 1);
    assert.equal(a, b);
  });
  it('다른 텍스트 → 개별 파싱', () => {
    const fake = new CountingFake();
    const c = new CachedPhpSyntax(fake, 8);
    c.facts('a'); c.facts('b');
    assert.equal(fake.calls, 2);
  });
  it('용량 초과 시 가장 오래된 항목 축출 → 재요청은 재파싱', () => {
    const fake = new CountingFake();
    const c = new CachedPhpSyntax(fake, 2);
    c.facts('a'); c.facts('b'); c.facts('c'); // 용량 2 → a 축출
    c.facts('a');                             // 재파싱
    assert.equal(fake.calls, 4);
  });
  it('히트가 LRU 순서를 갱신 — A 히트 후 C 삽입이면 B가 축출된다', () => {
    const fake = new CountingFake();
    const c = new CachedPhpSyntax(fake, 2);
    c.facts('a'); c.facts('b'); // 캐시 [a,b]
    c.facts('a');               // 히트 → [b,a]
    c.facts('c');               // b 축출 → [a,c]
    c.facts('a');               // 히트 — 파싱 없어야 함
    c.facts('b');               // 축출됐으므로 재파싱
    assert.equal(fake.calls, 4); // a, b, c, b
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx mocha test/unit/infra/cached-php-syntax.test.ts`
Expected: FAIL — `Cannot find module '.../cached-php-syntax'` (모듈 미존재).

- [ ] **Step 3: 구현**

`src/infrastructure/caching/cached-php-syntax.ts` 신규 생성:

```ts
import { DocumentFacts } from '../../domain/code-analysis/facts';
import { PhpSyntax } from '../../domain/code-analysis/ports/php-syntax';

/** 텍스트 내용을 키로 DocumentFacts를 LRU 캐시하는 데코레이터.
 *  facts()는 순수(같은 텍스트 → 같은 팩트)이므로 내용 키가 안전하다.
 *  반환 객체는 히트 간 공유된다 — 호출자는 팩트를 변형하지 않는다(기존 관례). */
export class CachedPhpSyntax implements PhpSyntax {
  private cache = new Map<string, DocumentFacts>();
  constructor(private inner: PhpSyntax, private capacity = 8) {}

  facts(text: string): DocumentFacts {
    const hit = this.cache.get(text);
    if (hit) {
      this.cache.delete(text); this.cache.set(text, hit); // Map 삽입 순서 = LRU 순서
      return hit;
    }
    const f = this.inner.facts(text);
    this.cache.set(text, f);
    if (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return f;
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx mocha test/unit/infra/cached-php-syntax.test.ts`
Expected: PASS — 4건 녹색.

- [ ] **Step 5: 컴포지션 루트 결선**

`src/extension.ts`:

1. import 추가:
```ts
import { CachedPhpSyntax } from './infrastructure/caching/cached-php-syntax';
```

2. `activate()` 안의 syntax 생성부를 다음으로 교체 (`let syntax: TreeSitterPhpSyntax;` 선언과 try 블록 안 대입 — 나머지 catch/에러 처리 무변경):
```ts
  let syntax: CachedPhpSyntax;
  try {
    syntax = new CachedPhpSyntax(await TreeSitterPhpSyntax.create(path.join(ctx.extensionPath, 'dist')), 8);
  } catch (err) {
```

- [ ] **Step 6: 전체 회귀 확인**

Run: `npm run test:unit && npx tsc -noEmit`
Expected: 전부 통과 (기존 58건 + 신규 4건 = 62건, 타입 체크 녹색).

- [ ] **Step 7: Commit**

```bash
git add src/infrastructure/caching/cached-php-syntax.ts src/extension.ts test/unit/infra/cached-php-syntax.test.ts
git commit -m "feat(infra): 팩트 LRU 캐시 데코레이터 — 동일 텍스트 중복 파싱 제거"
```

---

### Task 2: KeyedDebouncer + 진단 debounce 결선

**Files:**
- Create: `src/presentation/keyed-debouncer.ts`
- Modify: `src/presentation/providers/record-diagnostics.ts`
- Test: `test/unit/presentation/keyed-debouncer.test.ts`

**Interfaces:**
- Consumes: 없음 (Task 1과 독립 — 순수 타이머 유틸과 vscode 결선).
- Produces: `KeyedDebouncer` — 생성자 `(delayMs: number)`, 메서드 `schedule(key: string, fn: () => void): void`, `cancel(key: string): void`, `dispose(): void`.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/unit/presentation/keyed-debouncer.test.ts` 신규 생성 (실제 타이머 15ms, 여유 대기 40ms):

```ts
import { strict as assert } from 'assert';
import { KeyedDebouncer } from '../../../src/presentation/keyed-debouncer';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('KeyedDebouncer', () => {
  it('지연 후 정확히 1회 실행 (대기 중에는 미실행)', async () => {
    const d = new KeyedDebouncer(15);
    let n = 0;
    d.schedule('k', () => n++);
    assert.equal(n, 0); // 아직 대기 중
    await sleep(40);
    assert.equal(n, 1);
  });
  it('연속 schedule은 타이머 리셋 — 마지막 fn만 실행', async () => {
    const d = new KeyedDebouncer(15);
    const seen: string[] = [];
    d.schedule('k', () => seen.push('first'));
    d.schedule('k', () => seen.push('second'));
    await sleep(40);
    assert.deepEqual(seen, ['second']);
  });
  it('다른 key는 서로 독립', async () => {
    const d = new KeyedDebouncer(15);
    let a = 0, b = 0;
    d.schedule('a', () => a++);
    d.schedule('b', () => b++);
    await sleep(40);
    assert.equal(a, 1); assert.equal(b, 1);
  });
  it('cancel(key)은 대기 중 실행을 막는다', async () => {
    const d = new KeyedDebouncer(15);
    let n = 0;
    d.schedule('k', () => n++);
    d.cancel('k');
    await sleep(40);
    assert.equal(n, 0);
  });
  it('dispose()는 전체 대기 취소', async () => {
    const d = new KeyedDebouncer(15);
    let n = 0;
    d.schedule('a', () => n++);
    d.schedule('b', () => n++);
    d.dispose();
    await sleep(40);
    assert.equal(n, 0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx mocha test/unit/presentation/keyed-debouncer.test.ts`
Expected: FAIL — `Cannot find module '.../keyed-debouncer'`.

- [ ] **Step 3: 구현**

`src/presentation/keyed-debouncer.ts` 신규 생성 (vscode import 금지):

```ts
/** key별 debounce 타이머. 같은 key로 재호출하면 리셋되어 마지막 fn만 실행된다.
 *  vscode 의존 없음 — 유닛 테스트 가능. */
export class KeyedDebouncer {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private delayMs: number) {}

  schedule(key: string, fn: () => void): void {
    const prev = this.timers.get(key);
    if (prev) clearTimeout(prev);
    this.timers.set(key, setTimeout(() => { this.timers.delete(key); fn(); }, this.delayMs));
  }

  cancel(key: string): void {
    const t = this.timers.get(key);
    if (t) { clearTimeout(t); this.timers.delete(key); }
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx mocha test/unit/presentation/keyed-debouncer.test.ts`
Expected: PASS — 5건 녹색.

- [ ] **Step 5: 진단 결선 변경**

`src/presentation/providers/record-diagnostics.ts` — import·상수 추가 후 `registerDiagnostics` 본문 수정. `refresh` 함수와 설정 토글 핸들러는 무변경. 변경 지점만:

1. 상단:
```ts
import { KeyedDebouncer } from '../keyed-debouncer';

const CHANGE_DEBOUNCE_MS = 300;
```

2. 함수 서두 — debouncer 생성과 dispose 등록 (`coll` 생성 직후):
```ts
  const debouncer = new KeyedDebouncer(CHANGE_DEBOUNCE_MS);
  ctx.subscriptions.push(coll, { dispose: () => debouncer.dispose() });
```
(기존의 `ctx.subscriptions.push(coll);` 단독 줄은 위 줄로 대체)

3. 이벤트 결선 — 기존 `ctx.subscriptions.push(...)` 블록에서 두 줄만 교체:
```ts
    // 타이핑 중 keystroke마다 재파싱하지 않도록 문서별 debounce (열림/토글은 즉시 유지)
    vscode.workspace.onDidChangeTextDocument(e => debouncer.schedule(e.document.uri.toString(), () => refresh(e.document))),
    vscode.workspace.onDidCloseTextDocument(d => { debouncer.cancel(d.uri.toString()); coll.delete(d.uri); }),
```
(`onDidOpenTextDocument(refresh)`, `onDidChangeConfiguration(...)`, 초기 `vscode.workspace.textDocuments.forEach(refresh)`는 무변경 — 즉시 실행 유지.)

- [ ] **Step 6: 전체 회귀 확인**

Run: `npm run test:unit && npx tsc -noEmit && npm run lint`
Expected: 전부 통과 (62 + 5 = 67건). lint가 presentation 레이어 규칙 위반을 잡지 않는지 확인.

- [ ] **Step 7: Commit**

```bash
git add src/presentation/keyed-debouncer.ts src/presentation/providers/record-diagnostics.ts test/unit/presentation/keyed-debouncer.test.ts
git commit -m "feat(presentation): 진단 문서별 300ms debounce — 타이핑 중 재파싱 중단"
```

---

### Task 3: 문서 갱신 + 최종 검증

**Files:**
- Modify: `docs/PHASE2-BACKLOG.md`
- Modify: `docs/manual-verification.md`

**Interfaces:**
- Consumes: Task 1·2 완료 상태 (코드 변경 없음).
- Produces: 갱신된 문서 — 백로그 2번 완료, 수동 검증 체크리스트에 debounce 항목, 낡은 "알려진 제한" 문단 현행화.

- [ ] **Step 1: 백로그 2번 완료 표시**

`docs/PHASE2-BACKLOG.md`의 "## Phase 2 후속 작업 (우선순위 순)" 목록에서 2번 항목(`2. **진단 debounce + 파싱 공유**: …`)을 다음으로 교체:

```markdown
2. ~~**진단 debounce + 파싱 공유**~~ — ✅ 완료 (2026-08-04, 설계: `docs/superpowers/specs/2026-08-04-diagnostics-debounce-facts-cache-design.md`). 문서별 300ms debounce + 텍스트 키 LRU 팩트 캐시(용량 8).
```

- [ ] **Step 2: 수동 검증 체크리스트 추가**

`docs/manual-verification.md`의 `5. 설정 csmscode.diagnostics.enable=false → 진단 사라짐 확인` 줄 다음에 추가:

```markdown
6. 대형 php 파일에서 빠르게 타이핑 → 타이핑 중에는 진단이 갱신되지 않다가 멈춘 뒤 ~0.3초 후 갱신 (debounce)
7. 오타 컬럼이 있는 문서를 닫았다가 다시 열기 → 열자마자(지연 없이) 진단 표시, 닫힌 동안 진단 목록에 남지 않음
```

- [ ] **Step 3: 낡은 "알려진 제한" 문단 현행화**

`docs/manual-verification.md`의 "## 알려진 제한 (Known limitations)" 아래 문단 전체(현재 "kill-on-reassign은 후속 단계 예정"이라 낡음)를 다음으로 교체:

```markdown
추론은 현재 함수 스코프 내 로컬 데이터플로우만 추적합니다. 단순 변수 재대입은
kill-on-reassign(2026-07-31)으로 추적되지만, 구조 분해(`[$a,$b] = …`)·복합(`+=`, `??=`)·
참조(`=&`) 대입은 캡처되지 않아 이전 바인딩이 유지될 수 있습니다(낙관 동작).
오탐 시 `csmscode.diagnostics.enable`로 진단을 끄거나 해당 변수에 정확한 `@var`
주석을 달 수 있습니다.
```

- [ ] **Step 4: 최종 전체 검증**

Run: `npm run test:unit && npm run lint && npm run compile && npx tsc -p tsconfig.test.json`
Expected: 전부 통과 — 유닛 67건(58 기존 + 4 캐시 + 5 debounce), eslint, 프로덕션 번들, 테스트 컴파일.

- [ ] **Step 5: Commit**

```bash
git add docs/PHASE2-BACKLOG.md docs/manual-verification.md
git commit -m "docs: debounce+캐시 완료 반영 — 수동 검증 항목 추가, 알려진 제한 현행화"
```
