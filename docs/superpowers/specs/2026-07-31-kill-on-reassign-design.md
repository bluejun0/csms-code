# CSMS Code — kill-on-reassign 추론 설계

- **작성일**: 2026-07-31
- **작성자**: Claude (jun0@bluesoft.co.kr 요청)
- **상태**: 설계 확정 (2026-07-31 사용자 승인) — 구현 계획 작성 단계
- **선행 문서**: `2026-07-23-csms-code-extension-design.md` (Phase 1 전체 설계), `docs/PHASE2-BACKLOG.md` (백로그 1번)

---

## 1. 배경과 목표

### 배경 — Phase 1의 유일한 알려진 오탐
현재 추론(`RecordTypeInference`)은 레코드 메서드 대입(`$rec = $DB->get_record('user', …)`)만 팩트로 캡처한다.
같은 변수를 이후 **다른 값으로 재대입**(`$rec = build_row();`)해도 그 재대입이 팩트에 없으므로
이전 테이블 바인딩이 남아, 정상 코드에 "column not in table" 진단 오탐이 발생할 수 있다
(PHASE2-BACKLOG.md "알려진 제한"에 기록됨).

### 부수 발견 — foreach 가림 버그
추론이 ② 대입 → ③ foreach 순서로 먼저 맞는 결과를 반환하므로, 같은 변수명이
앞서 레코드 대입된 뒤 foreach 항목으로 재사용되면(`$r = $DB->get_record('user', …); foreach ($rows as $r)`)
foreach 바인딩이 무시되고 이전 대입이 이긴다. "가장 가까운 선행 이벤트 승리" 구조로 함께 해결한다.

### 목표
1. 팩트 레이어가 **모든** 변수 LHS 대입을 캡처한다 (`= new X()`, `= func()`, `= $other`, 리터럴 포함).
2. 추론이 종류 무관 **가장 가까운 선행 대입**을 존중한다 — 알 수 없는 값으로의 재대입은 바인딩을 죽인다(kill).
3. kill은 **모든 기능**(완성·hover·정의·진단)에 일관 적용한다 — 추론 경로는 하나 (2026-07-31 사용자 결정).
4. 기존 동작 보존: phpdoc `@var` 절대 우선, dataarg 폴백, 프로퍼티 쓰기 비-kill.

### 비목표(YAGNI)
- 구조 분해 대입(`[$a, $b] = …`), 복합 대입(`+=`, `??=`) 추적 — 미캡처 시 기존과 동일한 낙관 동작이므로 제외.
- dataarg의 위치 인식(현행 스코프 전역 유지).
- 크로스 스코프/by-ref 클로저 캡처 데이터플로우.

---

## 2. 동작 명세

변수 사용 지점에서 **동일 스코프 내 선행 이벤트 중 가장 가까운 것**이 바인딩을 결정한다:

| 가장 가까운 선행 이벤트 | 결과 |
|---|---|
| phpdoc `@var 테이블명 $x` (실존 테이블) | **항상 최우선** — 위치 비교에 참여하지 않고 기존처럼 절대 우선. 오탐 회피 수단이 자기 다음 대입에 죽지 않도록. |
| 레코드 대입 (`RECORD_METHODS` + 리터럴 테이블 + 실존 테이블) | 해당 테이블로 바인딩 (`source: 'assignment'`) |
| foreach 항목 바인딩 (컬렉션이 유효한 레코드 대입 유래) | 컬렉션의 테이블로 바인딩 (`source: 'foreach'`) |
| **그 외 모든 일반 대입** | **kill** — 대입/foreach 경로 바인딩 없음 |

- kill 이후에도 **dataarg 폴백(④)은 그대로 평가**한다. `$data = new stdClass(); $data->x = …; $DB->insert_record('tbl', $data);`
  패턴에서 `new stdClass` 대입이 kill이지만 dataarg가 `tbl`로 바인딩하는 기존 핵심 동작이 보존된다.
- `$rec->prop = 1` 프로퍼티 쓰기는 LHS가 변수가 아니므로 kill이 **아니다**.
- foreach의 **컬렉션 변수 해석에도 같은 규칙** 적용: 컬렉션이 레코드 대입 후 재대입되었으면 항목 바인딩 없음.

### 대표 시나리오
```php
$rec = $DB->get_record('user', $c);
echo $rec->firstname;        // user 바인딩 (기존과 동일)
$rec = build_row();
echo $rec->custom_field;     // kill — 진단·완성·hover 침묵 (기존: user 오탐)
$rec = $DB->get_record('course', $c);
echo $rec->fullname;         // course 재바인딩
```

---

## 3. 변경 상세

### 3.1 팩트 스키마 (`src/domain/code-analysis/facts.ts`)
```ts
export interface PlainAssignment { varName: string; index: number; scope: Scope; }
// DocumentFacts에 추가:
plainAssignments: PlainAssignment[];
```
기존 배열·인터페이스는 무변경 (비파괴 확장).

### 3.2 팩트 추출 (`src/infrastructure/tree-sitter/tree-sitter-php-syntax.ts`)
새 쿼리 1개 추가, 인스턴스당 1회 컴파일(기존 관례 준수):
```
(assignment_expression left: (variable_name (name) @var))
```
- RHS 종류 무관 전부 캡처 — 레코드 대입도 포함된다(추론에서 index 동일성으로 자연 처리).
- LHS가 `member_access_expression`(프로퍼티 쓰기)·구조 분해이면 매칭되지 않는다 (의도).
- `index`는 `@var` 노드의 `startIndex`, `scope`는 기존 `scopeOf` 재사용 — 기존 `RecordAssignment.index`와 같은 기준이라 동일 대입이면 index가 일치한다.

### 3.3 추론 (`src/domain/code-analysis/record-type-inference.ts`)
`infer()` 시그니처 무변경. 내부 로직:

1. **① phpdoc**: 무변경 (절대 우선).
2. **②+③ 병합 + kill 가드**:
   - `k` = `nearestPreceding(plainAssignments[varName, scope], atIndex)` — 가장 가까운 일반 대입.
   - `asg` = 가장 가까운 유효 레코드 대입 (기존 필터), `fe` = 가장 가까운 foreach 바인딩.
   - 후보 중 **index가 더 큰(가까운) 쪽**을 선택하되, 선택된 후보의 `index >= k.index`일 때만 채택
     (k가 없으면 무조건 채택). 레코드 대입은 자신이 plain 대입이기도 하므로 같은 index로 통과.
   - foreach 후보의 컬렉션 해석: `fe.index` 시점에서 컬렉션 변수에 동일한 kill 가드 적용.
3. **④ dataarg**: 무변경 (kill과 무관하게 폴백 평가, 다중 테이블 모호 시 null 가드 유지).

application/presentation 레이어는 무변경 (추론 시그니처 유지).

### 3.4 문서 (`docs/PHASE2-BACKLOG.md`)
- "알려진 제한 — 재대입 미추적" 항목 제거, 백로그 1번을 완료로 표시.
- 신규 제한 추가: 구조 분해·복합 대입 미추적(낙관 동작), dataarg 위치 무관(기존).

---

## 4. 테스트 전략

### 도메인 (`test/unit/domain/inference.test.ts` 확장)
1. 레코드 대입 → 일반 재대입 → kill (대표 오탐 시나리오).
2. kill 이후 재차 레코드 대입 → 재바인딩.
3. foreach 항목이 앞선 레코드 대입을 이김 (가림 버그 수정 확인).
4. foreach 항목 사용 후 재대입 → kill.
5. phpdoc `@var`은 후속 일반 대입에도 생존 (절대 우선).
6. dataarg는 `new stdClass` kill에도 생존.
7. 컬렉션 변수 재대입 후 foreach → 항목 바인딩 없음.
8. 다른 스코프의 일반 대입은 kill 아님 (sameScope 가드).

### 인프라 (`test/unit/infra/tree-sitter.test.ts` 확장)
1. `= func()` / `= new X()` / `= $other` / `= 리터럴` / `= $obj->m()` 전부 `plainAssignments`로 캡처.
2. `$rec->prop = 1` 비캡처.
3. 클로저 내부 대입의 scope가 클로저로 잡힘 (외부와 분리).
4. 레코드 대입이 `assignments`와 `plainAssignments` 양쪽에 같은 index로 존재.

### 회귀
기존 유닛 테스트 전부 녹색 유지 (`npm run test:unit`). 통합 테스트는 기존 하드 게이트와 동일하게 CI/xvfb 몫.

---

## 5. 성공 기준
- §2 대표 시나리오가 유닛 테스트로 재현되고 오탐이 사라진다.
- foreach 가림 버그 시나리오가 올바른 테이블로 바인딩된다.
- 기존 테스트 무회귀, 신규 팩트로 인한 추론 시그니처·상위 레이어 변경 없음.
