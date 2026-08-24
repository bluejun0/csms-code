# CSMS Code — get_string 컴포넌트 리터럴 전파

- **작성일**: 2026-08-11
- **상태**: 설계 확정 — 구현 계획 작성 단계
- **요청**: "string의 경우, 두 번째 인자에 `$CFG->xxx` 로 들어가면 전혀 추적을 못해요"

---

## 1. 배경

`stringCalls` 팩트는 키와 컴포넌트가 **둘 다 문자열 리터럴**일 때만 만들어진다(`Q_STRING_CALL`이 `string_content` 두 개를 요구). 컴포넌트가 표현식이면 팩트 자체가 없어 이동·hover·하이라이트·진단이 전부 침묵한다.

### 실측 (hlulxp `local`·`theme/coursemos`·`blocks`)

| 두 번째 인자 | 건수 | 같은 파일에 문자열 리터럴 정의가 있는 비율 |
|---|---|---|
| 리터럴(현재 지원) | 3,106 | — |
| `$변수` | 1,655 | **86.7%** |
| `$this->프로퍼티` | 800 | **83.9%** |
| `Class::CONST` | 14 | 50.0% |
| 보간·기타(`"block_{$b->name}"`) | 152 | 0% |
| **동적 합계** | **2,621** | **80.6% (2,113건)** |

요청에 나온 `$CFG->xxx` 형태는 이 저장소에 **0건**이다. 실제로 지배적인 것은 `$this->pluginname`(793)과 지역 변수다. 같은 메커니즘이 `$CFG->`도 덮으므로(설정 리터럴을 출처로 추가하면 된다) 요청의 의도는 포함된다.

**모호성은 0건이다.** 리터럴이 잡히는 2,106건 전부 같은 파일에 서로 다른 리터럴이 하나뿐이다(변수 1,435 / 프로퍼티 671). 따라서 "리터럴이 유일할 때만 해석" 가드는 커버리지를 깎지 않는다.

프로퍼티 쪽은 출처를 더 갈라 재봤다. 해석되는 671건이 **전부 선언 기본값**(`protected $pluginname = 'local_x';`)이고 `$this->prop = '리터럴'` 형태의 생성자 대입은 **0건**이며, 이 호출들이 있는 파일에 클래스가 둘 이상인 경우도 **0건**이다. 그래서 프로퍼티 출처는 **선언 기본값만** 본다 — 생성자 대입을 파일 범위로 병합하다 다른 클래스의 사용처로 새는 위험이 아예 없어진다. 한 파일에 두 클래스가 같은 이름을 다른 값으로 선언하면 값이 둘이 되어 모호성 가드가 침묵시킨다.

## 2. 목표

컴포넌트 인자가 **같은 파일의 문자열 리터럴로 한 단계 거슬러 올라가면** 그 컴포넌트로 해석해, 기존 문자열 표면 네 가지(정의 이동·hover·하이라이트·누락 키 진단)를 그대로 적용한다.

- `$var` → 같은 스코프의 리터럴 대입
- `$this->prop` → 프로퍼티 리터럴 대입 또는 선언 기본값(파일 범위)
- `Class::CONST` → const 선언 리터럴(파일 범위)

### 비목표
- 파일을 넘는 전파(다른 파일의 클래스 프로퍼티·상수), 상속 체인, 함수 반환값.
- 문자열 보간(`"block_{$b->name}"`)·연결(`'mod_' . $type`) 해석 — 실측 152건, 침묵 유지.
- **키 유일성 폴백**(색인 전체에서 그 키를 가진 컴포넌트가 하나면 그리로 보내기 — 실측 2,070건). 근거가 추측이라 진단에 쓸 수 없고, 이동·hover만 따로 켜는 것은 다음 사이클 판단.
- `$CFG->` 출처(`config.php` 리터럴) — 이 저장소에 사례가 없어 이번엔 넣지 않는다.

## 3. 설계

### 3.1 팩트 추가

기존 `stringCalls`(리터럴 두 개)는 **손대지 않는다** — 이미 테스트로 고정된 경로다. 동적 컴포넌트는 별도 팩트로 담고, 해석은 도메인에서 한다.

```ts
export type ComponentRef =
  | { kind: 'var'; name: string }
  | { kind: 'prop'; name: string }
  | { kind: 'const'; name: string };

export interface DynamicStringCall {
  key: string; comp: ComponentRef;
  keyLine: number; keyColumn: number; keyIndex: number;
  index: number; scope: Scope;
}

/** `$x = 'literal'` — RHS 리터럴이 필요해 plainAssignments로는 안 된다. */
export interface LiteralAssignment { varName: string; value: string; index: number; scope: Scope; }
/** 프로퍼티 **선언 기본값** `public $p = 'literal';` — 생성자 대입은 담지 않는다(실측 0건). */
export interface PropertyLiteral { property: string; value: string; index: number; }
/** `const NAME = 'literal';` — 파일 범위. */
export interface ConstLiteral { name: string; value: string; index: number; }
```
`DocumentFacts`에 `dynamicStringCalls`·`literalAssignments`·`propertyLiterals`·`constLiterals`를 더한다(`emptyFacts()`도 함께).

쿼리는 두 번째 인자를 형태로 갈라 잡는다 — 세 개를 각각 두는 편이 술어 없이 정확하다.
```
; $var
(function_call_expression function: (name) @fn arguments: (arguments
  . (argument (string (string_content) @key)) . (argument (variable_name (name) @comp))))
; $this->prop
(function_call_expression function: (name) @fn arguments: (arguments
  . (argument (string (string_content) @key))
  . (argument (member_access_expression object: (variable_name) @recv name: (name) @comp))))
; 프로퍼티 선언 기본값
(property_declaration (property_element (variable_name (name) @prop) (property_initializer (string (string_content) @value))))
; Class::CONST
(function_call_expression function: (name) @fn arguments: (arguments
  . (argument (string (string_content) @key))
  . (argument (class_constant_access_expression (name) @comp))))
```
`@fn`이 `get_string`이 아니면 버린다(기존 관례). `prop`은 수신자가 `$this`일 때만 담는다.

### 3.2 해석 (도메인)

`src/domain/lang-model/services/component-propagation.ts`

```ts
export function resolveComponentRef(facts: DocumentFacts, call: DynamicStringCall): string | null;
```
- `var`: **같은 스코프에서 그 이름에 대입된 서로 다른 리터럴이 하나뿐일 때** 그 값. 둘 이상이면 null. 레코드 추론의 `nearestPreceding`·kill은 쓰지 않는다 — 컴포넌트 변수는 함수 중간에 다른 값으로 바뀌지 않고(실측 모호성 0), 규칙이 하나여야 구현이 갈리지 않는다.
- `prop`: `propertyLiterals` 중 그 이름의 서로 다른 값이 하나뿐일 때 그 값(파일 범위).
- `const`: `constLiterals` 동일 규칙.

값이 컴포넌트 꼴인지는 판정하지 않는다 — 색인에 없으면 다음 단계에서 자연히 침묵한다.

### 3.3 소비자 통합

애플리케이션에 헬퍼 하나를 두고 **네 유즈케이스가 모두 그것만 쓴다**.
```ts
// application/string-call-lookup.ts (기존 파일)
export function allStringCalls(facts: DocumentFacts): StringCall[];
```
리터럴 호출 + 해석된 동적 호출을 합쳐 `StringCall` 모양으로 준다(`component`는 해석 결과). 해석 실패는 목록에서 빠진다.

`ResolveStringDefinition`·`DescribeString`·`ValidateStringKeys`·`ListResolvedStringCalls`가 `facts.stringCalls` 대신 이 헬퍼를 쓴다. 한 곳만 고치면 네 기능이 함께 따라오고, 갈라질 수 없다.

**진단**: 해석된 컴포넌트도 누락 키 검사를 받는다. 기존 가드(색인에 없는 컴포넌트는 경고하지 않음)가 그대로 적용되고, 전파 쪽에는 "리터럴이 유일할 때만" 가드가 더 붙는다.

**사용처 색인**(`php-usage-index.ts`)은 정규식 기반이라 이번 범위 밖이다 — lang 파일의 Shift+F12에는 동적 컴포넌트 호출이 여전히 안 나온다. 정의 이동은 되는데 역참조는 안 되는 비대칭이라 **README의 알려진 제한에도 적는다**(백로그만으로는 사용자가 버그로 읽는다).

## 4. 테스트 전략

- **팩트**: 세 형태 각각 추출, `$this` 아닌 수신자 비추출, `get_string` 아닌 함수 비추출, 위치 정확성, 리터럴 컴포넌트 호출은 기존 `stringCalls`에만 담기고 동적 목록에는 없음.
- **해석**: 변수·프로퍼티·상수 각각 해석, 서로 다른 리터럴이 둘이면 null, 다른 스코프의 대입은 변수 해석에 쓰이지 않음, 정의가 없으면 null.
- **통합**: `allStringCalls`가 리터럴+동적을 합치고 해석 실패를 뺀다. **리터럴 컴포넌트 호출이 정확히 한 번만 나온다**(두 쿼리가 겹치면 하이라이트·진단이 두 번 나온다).
- **오탐 경로**: `$component = get_component();` 처럼 리터럴이 아닌 대입에서 온 컴포넌트는 진단이 붙지 않는다. 네 유즈케이스가 동적 호출에서도 동작(정의 이동·hover·하이라이트·진단) — E2E로.
- **진단 안전성**: 해석된 컴포넌트가 색인에 없으면 경고 없음. 모호한 전파는 경고 없음.
- **회귀**: 기존 357건 녹색.

## 5. 성공 기준

- `$component = 'local_ubattend'; … get_string('attendance_book', $component)` 에서 F12·hover·하이라이트가 동작한다.
- `class X { protected $pluginname = 'local_ubattend'; … get_string('k', $this->pluginname) }` 도 동작한다.
- 같은 파일에 서로 다른 리터럴이 둘이면 아무 반응도 없다.
- 기존 357건 무회귀, lint/compile 통과, 버전 0.14.0 + CHANGELOG.
