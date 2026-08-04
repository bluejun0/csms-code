# CSMS Code — 진단 debounce + 팩트 캐시 설계

- **작성일**: 2026-08-04
- **작성자**: Claude (jun0@bluesoft.co.kr — "다음 작업 알아서" 위임, 설계 결정은 Claude가 내리고 본 문서에 근거 기록)
- **상태**: 설계 확정 — 구현 계획 작성 단계
- **선행 문서**: `docs/PHASE2-BACKLOG.md` (후속 작업 2번), `2026-07-23-csms-code-extension-design.md`

---

## 1. 배경과 목표

### 배경 — keystroke마다 문서 전체 재파싱
- `record-diagnostics.ts`의 `onDidChangeTextDocument(e => refresh(e.document))`가 **키 입력마다** `ValidateRecordColumns.run(doc.getText())`을 호출하고, 이는 매번 tree-sitter 전체 재파싱이다.
- 4개 유즈케이스(validate/complete/resolve/describe)가 각자 `syntax.facts(text)`를 호출한다 — 같은 문서 버전에서 hover·완성·진단이 겹치면 **동일 텍스트를 최대 3~4회 중복 파싱**한다.
- 대형 PHP 파일(Moodle lib 수천 줄)에서 타이핑 지연 체감 원인.

### 목표
1. 진단을 문서별(per-uri) **debounce**(300ms)하여 타이핑 중 재파싱 폭주를 멈춘다.
2. **팩트 캐시**로 동일 텍스트 재파싱을 제거한다 — 유즈케이스 4개가 자동으로 공유.
3. 두 컴포넌트 모두 vscode 의존 없는 순수 TS로 만들어 **유닛 테스트 가능**하게 한다.
4. 포트(`PhpSyntax`)·유즈케이스·프로바이더 시그니처 무변경.

### 비목표(YAGNI)
- tree-sitter incremental parse(`tree.edit`) — tree를 살려둬야 해서 기존 `tree.delete()` WASM 힙 관리 설계와 충돌. 필요해지면 별도 스펙.
- debounce 지연시간 설정화(settings) — 백로그 요구 없음, 상수(300ms)로 시작.
- uri/version 키 캐시 — 포트 시그니처 변경 파급이 커서 기각(아래 §2 결정 근거).

---

## 2. 접근 결정 (대안 비교)

| 접근 | 내용 | 판정 |
|---|---|---|
| **A. 텍스트 키 LRU 데코레이터 + KeyedDebouncer (채택)** | `CachedPhpSyntax implements PhpSyntax`가 텍스트 문자열을 키로 `DocumentFacts`를 LRU 캐시(8개). 컴포지션 루트에서 한 줄 랩핑. 진단은 per-uri 300ms debounce | 포트 무변경, 결선 1줄, 테스트 쉬움 |
| B. 포트 확장 `facts(text, key)` + uri/version 캐시 | 캐시 키가 정밀하지만 포트→유즈케이스 4개→프로바이더 4개 시그니처 전파 | 파급 과다, 기각 |
| C. incremental parse | 최고 성능이지만 WASM tree 수명 관리 복잡화 | Phase 3감, 기각 |

**텍스트 키의 정당성**: JS `Map`의 문자열 키 조회는 엔진이 해시로 처리한다. 항목 8개 한도의 LRU에서 키 메모리(파일 크기 × 8)와 조회 비용 모두 무시 가능. 내용이 같으면 문서가 달라도 팩트가 동일하므로(순수 함수) 오염 위험 없음.

---

## 3. 동작 명세

### 3.1 `CachedPhpSyntax` (infrastructure)
- `facts(text)`: 캐시 히트 시 **동일 객체** 반환(파싱 0회), 미스 시 내부 `PhpSyntax`에 위임 후 저장.
- LRU: 히트 시 항목을 최신으로 갱신(delete→set), 용량 초과 시 가장 오래된 항목 축출. 용량 기본 8, 생성자 인자.
- 반환 객체는 공유되므로 **호출자는 팩트를 변형하지 않는다**(기존 코드도 변형하지 않음 — 읽기 전용 관례 유지).

### 3.2 `KeyedDebouncer` (presentation, vscode 무의존)
- `schedule(key, fn)`: key별 타이머. 이미 대기 중이면 리셋(마지막 fn만 실행).
- `cancel(key)`: 해당 key의 대기 취소. `dispose()`: 전체 취소.
- 지연시간은 생성자 인자(프로덕션 300ms, 테스트 ~15ms).

### 3.3 진단 결선 변경 (`record-diagnostics.ts`)
| 이벤트 | 동작 |
|---|---|
| 활성화 시 초기 스캔 / `onDidOpenTextDocument` | **즉시** refresh (열자마자 진단 표시, 지연 없음) |
| `onDidChangeTextDocument` | `debouncer.schedule(uri, () => refresh(doc))` — 300ms |
| `onDidCloseTextDocument` | `debouncer.cancel(uri)` + 진단 삭제 — 닫힌 문서에 타이머가 나중에 발화해 진단을 되살리는 누수 방지 |
| 설정 토글(`csmscode.diagnostics.enable`) | 기존대로 즉시 전체 refresh |
| 확장 dispose | `debouncer.dispose()` (subscriptions에 Disposable 등록) |

### 3.4 캐시 결선 (`extension.ts`)
```ts
const syntax = new CachedPhpSyntax(await TreeSitterPhpSyntax.create(...), 8);
```
유즈케이스 4개가 같은 인스턴스를 받으므로 자동 공유. hover→완성→진단이 같은 문서 버전을 연달아 요청하는 시나리오가 전부 히트.

---

## 4. 변경 상세

**Create:**
- `src/infrastructure/caching/cached-php-syntax.ts` — LRU 데코레이터 (~30줄)
- `src/presentation/keyed-debouncer.ts` — 타이머 관리 (~25줄, vscode import 금지)

**Modify:**
- `src/presentation/providers/record-diagnostics.ts` — debounce 결선 (§3.3 표)
- `src/extension.ts` — 캐시 랩핑 1줄 + import

**Test:**
- `test/unit/infra/cached-php-syntax.test.ts` — fake PhpSyntax(호출 카운터)로: 동일 텍스트 2회 → 파싱 1회·동일 객체 / 다른 텍스트 → 개별 파싱 / 용량 2에서 A,B,C → A 축출 재파싱 / A,B 후 A 히트, C 삽입 → B 축출·A 유지(LRU 갱신 검증)
- `test/unit/presentation/keyed-debouncer.test.ts` — 실제 타이머(15ms)로: 지연 후 1회 실행 / 연속 schedule 시 마지막만 / key 독립성 / cancel / dispose
- `docs/manual-verification.md` — 타이핑 중 진단 지연 확인 항목 추가

**Docs:** `docs/PHASE2-BACKLOG.md` 2번 완료 표시.

---

## 5. 테스트 전략과 성공 기준
- 신규 유닛 테스트 ~9건 전부 녹색, 기존 58건 무회귀 (`npm run test:unit`).
- `record-diagnostics.ts`의 vscode 결선 자체는 유닛 불가 → 통합 테스트(CI 게이트, 기존과 동일)와 manual-verification 체크리스트로 커버.
- 성공 기준: keystroke당 파싱 0회(디바운스 대기 중), 동일 텍스트 중복 파싱 0회, 열림/토글 시 즉시 진단 유지, 닫힌 문서 진단 부활 없음.
