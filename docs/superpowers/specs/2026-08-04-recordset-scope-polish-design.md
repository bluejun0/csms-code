# CSMS Code — 컬렉션 직접 바인딩 제거 + 스코프 정밀화 + 폴리시 설계

- **작성일**: 2026-08-04
- **작성자**: Claude (jun0@bluesoft.co.kr — "알아서" 위임, 설계 결정은 Claude가 내리고 본 문서에 근거 기록)
- **상태**: 설계 확정 — 구현 계획 작성 단계
- **선행 문서**: `docs/PHASE2-BACKLOG.md` (3번·11번), debounce+캐시 최종 리뷰 폴리시 3건 (2026-08-04)

---

## 1. 배경과 목표

### 1a. 컬렉션 직접 바인딩 (백로그 3번)
`$rs = $DB->get_recordset('user', …)`의 `$rs`는 stdClass 레코드가 아니라 **moodle_recordset 객체**다
(메서드: `close()`, `valid()` 등). 그런데 `RECORD_METHODS`에 recordset 계열이 포함되어 있어 `$rs->`
입력 시 user 테이블 컬럼 완성이 떠 오해를 유발한다.

**결정 — 백로그 문면보다 넓힘**: `$rows = $DB->get_records(…)`의 `$rows`(연관 배열)도 같은 문제다 —
유효한 PHP에서 배열 변수에 `->` 접근은 없으므로 컬럼 완성·진단 모두 오해 소지다. 따라서 직접
바인딩은 **단일 레코드 반환 메서드로만** 한정한다. 근거: 배열/recordset 모두 "변수 자체가 레코드가
아님"이라는 동일 원리이고, `$rows[$id]->prop`(subscript 경유)은 Q_PROP이 애초에 매칭하지 않아
잃는 인텔리전스가 없다.

### 1b. 클로저 스코프 누수 (백로그 11번)
`CompleteRecordColumns`의 `scopeContaining()`이 `plainAssignments`를 모른다. 일반 대입만 있는
클로저는 스코프 축소에 보이지 않아 커서가 바깥 함수 스코프로 폴백하고, 바깥 바인딩이 클로저 안
완성에 새어든다(2026-07-31 kill-on-reassign 최종 리뷰 발견).

### 1c. 폴리시 3건 (debounce+캐시 최종 리뷰, 2026-08-04)
1. 변경 핸들러가 모든 문서 변경(출력 채널 등)에 타이머를 만들었다 지운다 — php/file 가드를 schedule 앞으로.
2. `ctx.subscriptions.push(coll, { dispose: … })` — 처분 순서가 우연히 안전. `push(debouncer, coll)`로 명시적 안전 + 래퍼 제거(`KeyedDebouncer`는 구조적으로 `Disposable` 충족).
3. `CachedPhpSyntax`에 메모리 상한 주석 1줄(용량 8 × 최대 열린 파일 텍스트).

### 비목표(YAGNI)
- recordset 변수에 recordset 메서드(`close` 등) 완성 제공 — 별개 기능, 요구 없음.
- `$rows[$id]->` subscript 경유 바인딩 — Q_PROP 확장 필요, 요구 없음.

---

## 2. 동작 명세

### 2.1 메서드 집합 분리 (`record-type-inference.ts`)
`RECORD_METHODS` 단일 집합을 둘로 교체:

```ts
// 단일 stdClass 레코드 반환 → 변수 자체에 컬럼 바인딩 (② 직접 대입 경로)
const DIRECT_RECORD_METHODS = new Set(['get_record', 'get_record_select']);
// 레코드 컬렉션 반환 → foreach 항목 변수에만 바인딩 (③ 컬렉션 해석 경로)
const COLLECTION_METHODS = new Set(['get_records', 'get_records_select', 'get_recordset', 'get_recordset_select']);
```

| 코드 | 기존 | 변경 후 |
|---|---|---|
| `$rec = get_record(…); $rec->` | 바인딩 | 바인딩 (유지) |
| `$rows = get_records(…); $rows->` | 바인딩 (오해) | **null** |
| `$rs = get_recordset(…); $rs->` | 바인딩 (오해) | **null** |
| `foreach ($rows/$rs as $r) { $r-> }` | 바인딩 | 바인딩 (유지) |
| `foreach ($rec as $v) { $v-> }` (단일 레코드 순회) | 바인딩 (오류) | **null** — 항목은 필드 값이지 레코드가 아님 |

- ② 직접 대입 필터 → `DIRECT_RECORD_METHODS`, `resolveCollection`의 컬렉션 필터 → `COLLECTION_METHODS`.
- kill 가드·phpdoc·dataarg 로직 무변경. 컬렉션 대입도 여전히 `plainAssignments`에 잡히므로 재대입 kill은 그대로 동작.

### 2.2 scopeContaining 정밀화 (`complete-record-columns.ts`)
스코프 후보 수집 스프레드에 `facts.plainAssignments` 추가(+인라인 타입에 필드 추가). 효과: 일반
대입만 있는 클로저 안에서 완성 요청 시 스코프가 클로저로 좁혀져 바깥 바인딩이 새지 않는다.

### 2.3 진단 결선 폴리시 (`record-diagnostics.ts`)
```ts
ctx.subscriptions.push(debouncer, coll);   // 래퍼 제거 + debouncer 먼저 처분
…
vscode.workspace.onDidChangeTextDocument(e => {
  if (e.document.languageId !== 'php' || e.document.uri.scheme !== 'file') return; // 가드 선행 — 타이머 churn 제거
  debouncer.schedule(e.document.uri.toString(), () => refresh(e.document));
}),
```
`refresh` 내부 가드는 유지(다른 호출 경로 보호).

---

## 3. 테스트 전략

**도메인** (`inference.test.ts` 추가 5건): get_recordset 직접 → null / get_recordset_select 직접 → null /
get_records 직접 → null / foreach over get_recordset → 항목 바인딩 / foreach over get_record(단일) → null.
기존 `get_record 대입 → 테이블 바인딩`·foreach(get_records) 테스트가 회귀 감지.

**애플리케이션** (`usecases.test.ts` 추가 2건, 실제 tree-sitter):
1. 일반 대입만 있는 클로저 내부 위치에서 `CompleteRecordColumns.run(text, 'c', 클로저내index)` → `[]`
   (수정 전엔 바깥 스코프로 폴백해 컬럼이 새어들었음).
2. 양성 대조: 바깥 함수 위치에서 run → 컬럼 3개 (정상 완성 무회귀).

**프레젠테이션 폴리시**: 유닛 불가(vscode 결선) — 기존과 동일하게 통합 테스트(CI 게이트) 몫.
`KeyedDebouncer`가 Disposable로 직접 등록 가능함은 타입 체크(`tsc -noEmit`)가 보증.

## 4. 성공 기준
- 신규 7건 + 기존 67건 = 74건 전부 녹색, lint/compile/test-tsc 통과.
- §2.1 표의 5행이 전부 테스트로 재현.
- `docs/PHASE2-BACKLOG.md` 3번·11번 완료 표시.
