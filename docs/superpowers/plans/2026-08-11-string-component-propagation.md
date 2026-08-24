# get_string 컴포넌트 리터럴 전파 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 컴포넌트 인자가 같은 파일의 문자열 리터럴로 거슬러 올라가면 해석해, 문자열 표면 네 기능을 동적 호출에도 적용한다.

**Architecture:** 기존 `stringCalls`(리터럴 두 개)는 그대로 두고 동적 호출을 별도 팩트로 담는다. 해석은 도메인 함수 하나, 소비자 통합은 애플리케이션 헬퍼 하나.

## Global Constraints

- 설계 문서: `docs/superpowers/specs/2026-08-11-string-component-propagation-design.md`. 충돌 시 설계가 우선.
- 계층 규칙(eslint): `domain/`은 fs·vscode·infrastructure 금지, `application/`은 infrastructure 금지.
- **주석은 객관적으로만**.
- 기존 357건 무회귀.

---

### Task 1: 팩트 — 동적 호출과 리터럴 출처

**Files:** `src/domain/code-analysis/facts.ts`, `src/infrastructure/tree-sitter/tree-sitter-php-syntax.ts`, `test/unit/infra/tree-sitter.test.ts`

- [ ] 실패 테스트: 세 형태(`$var`·`$this->prop`·`Class::CONST`) 추출, `$this` 아닌 수신자·`get_string` 아닌 함수 비추출, 리터럴 컴포넌트 호출은 동적 목록에 없음, 위치 정확성, `literalAssignments`·`propertyLiterals`(선언 기본값만)·`constLiterals` 추출.
- [ ] 구현: `ComponentRef`·`DynamicStringCall`·`LiteralAssignment`·`PropertyLiteral`·`ConstLiteral` 추가(+`emptyFacts()`), 쿼리 다섯 개 컴파일·추출.
- [ ] 커밋: `feat(infra): 동적 컴포넌트 호출과 리터럴 출처 팩트`

### Task 2: 해석 + 소비자 통합

**Files:** `src/domain/lang-model/services/component-propagation.ts`, `src/application/string-call-lookup.ts`, 문자열 유즈케이스 4개, `test/unit/domain/component-propagation.test.ts`, `test/unit/application/string-usecases.test.ts`

- [ ] 실패 테스트: 세 종류 해석, 서로 다른 리터럴 둘이면 null, 다른 스코프 대입은 변수 해석에 안 쓰임, 정의 없으면 null. `allStringCalls`가 합치고 실패를 빼고 **리터럴 호출은 한 번만** 준다. E2E로 네 기능이 동적 호출에서 동작하고, 리터럴 아닌 대입에는 진단이 없다.
- [ ] 구현: `resolveComponentRef`, `allStringCalls`, 유즈케이스 네 곳 교체.
- [ ] 커밋: `feat(app): 컴포넌트 리터럴 전파를 네 문자열 기능에 통합`

### Task 3: 문서 + 버전

**Files:** `README.md`, `CHANGELOG.md`, `docs/PHASE2-BACKLOG.md`, `docs/manual-verification.md`, `package.json`

- [ ] 실측(hlulxp)으로 전후 해석 건수를 재고 문서에 적는다.
- [ ] README 알려진 제한에 "동적 컴포넌트는 정의 이동은 되지만 lang 쪽 Shift+F12에는 안 나온다" 추가.
- [ ] 백로그: 키 유일성 폴백(2,070건)과 사용처 색인 비대칭을 항목으로.
- [ ] 버전 0.14.0 + CHANGELOG, 최종 검증(`test:unit`·`lint`·`compile`·`test-tsc`).
