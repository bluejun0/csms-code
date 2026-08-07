# CSMS Code — Moodle 전역 인텔리전스

- **작성일**: 2026-08-07
- **상태**: 설계 확정 — 구현 계획 작성 단계
- **요청**: "$DB 같은것도 해주라… 스크립트 최상단에 있는 $DB $CFG 같은걸 알아서 해줘"
- **범위 확정**: 클래스 기반 + 설정 키 + 테이블 기반 전부

---

## 1. 배경

Moodle 스크립트는 `global $DB, $CFG, $USER;`로 시작한다. `global` 선언은 타입 정보를 담지 않으므로 일반 PHP 언어 서버는 이 변수들에 아무것도 주지 못한다 — 이 자리는 지금 완전히 비어 있다.

### 실측 (hlulxp `local`·`theme/coursemos`·`blocks`, PHP 1,856개)

`global` 선언문 2,122개. 선언되는 변수 상위: `$DB` 1,377 · `$CFG` 622 · `$USER` 409 · `$OUTPUT` 233 · `$PAGE` 91.

| 전역 | 접근 | 고유 이름 | 후보의 출처 | 확인률 |
|---|---|---|---|---|
| `$DB` | 2,768 | 47 | `moodle_database` 클래스 | **46/47** (미확인 1건은 `get_field_Sql` 오타) |
| `$CFG` | 1,627 | 107 | `config-dist.php` + `settings.php`의 `admin_setting_*` 선언 | 1,196/1,627 (**약 73%**) |
| `$PAGE` | 1,372 | 33 | `moodle_page` 클래스 | — |
| `$OUTPUT` | 1,280 | 36 | `core_renderer` 클래스 | — |
| `$USER` | 694 | 35 | `user` 테이블 | 87% (나머지는 런타임 필드) |
| `$SITE`·`$COURSE` | 85 | 5 | `course` 테이블 | 100%(표본 작음) |

세 가지 서로 다른 메커니즘이 필요하다: **클래스 멤버**, **설정 키**, **테이블 컬럼**.

### 확인해 둔 사실

- `moodle_page`의 프로퍼티는 대부분 `protected function magic_get_<name>()`로 구현된 매직 프로퍼티다(4.5 기준 41개). 메서드 목록만 뽑으면 `$PAGE->context`·`$PAGE->url`이 빠진다.
- `core_renderer`의 위치는 버전마다 다르다 — 4.5는 `lib/classes/output/core_renderer.php`, 3.9는 `lib/outputrenderers.php`(4.5의 같은 파일은 폐기 안내만 남은 1KB 껍데기다). 경로를 고정하면 안 된다.
- `moodle_database.php`·`pagelib.php`는 2.9.4까지 같은 경로에 있다.

## 2. 목표

1. `$DB->`·`$PAGE->`·`$OUTPUT->`에서 **메서드·프로퍼티 완성**(인자 시그니처와 설명 포함), hover, 코어 소스로 정의 이동.
2. `$CFG->`에서 **설정 키 완성**과 선언 위치로 이동.
3. `$USER->`·`$COURSE->`·`$SITE->`에서 **테이블 컬럼 완성**·hover·`install.xml`로 이동(기존 컬럼 엔진 재사용).

### 비목표
- **진단**. `$USER`는 사이트가 주입하는 런타임 필드가 실측 81건(`ubion` 62 등), `$CFG`는 `set_config`로 만들어지는 키가 실측 431회분이다. 경고를 붙이면 즉시 오탐이다.
- 테마별 렌더러(`theme_x_core_renderer`)·`$DB` 드라이버 하위 클래스·상속 체인 전체 해석. 지정한 클래스 하나만 읽는다.
- `$CFG` 값 표시(런타임 값이라 알 수 없다), 표에 없는 전역(`$SESSION` 등).

## 3. 설계

### 3.1 전역 표 (도메인)

`src/domain/moodle-model/globals.ts` — fs·vscode 없이 순수 표.

```ts
export type GlobalBinding =
  | { kind: 'class'; className: string }
  | { kind: 'table'; tableName: string }
  | { kind: 'config' };

export const MOODLE_GLOBALS: Record<string, GlobalBinding> = {
  DB: { kind: 'class', className: 'moodle_database' },
  PAGE: { kind: 'class', className: 'moodle_page' },
  OUTPUT: { kind: 'class', className: 'core_renderer' },
  USER: { kind: 'table', tableName: 'user' },
  COURSE: { kind: 'table', tableName: 'course' },
  SITE: { kind: 'table', tableName: 'course' },
  CFG: { kind: 'config' },
};
```

### 3.2 팩트 추가 — `methodCalls`

`$DB->get_record(…)`는 `member_call_expression`이라 기존 `propertyAccesses`(=`member_access_expression`)에 잡히지 않는다. hover·정의 이동이 메서드 이름 위에서 동작하려면 별도 팩트가 필요하다.

```ts
export interface MethodCall {
  varName: string; method: string;
  nameLine: number; nameColumn: number; nameIndex: number;
  index: number; scope: Scope;
}
```
쿼리는 `(member_call_expression object: (variable_name (name) @var) name: (name) @method)`.

### 3.3 클래스 멤버 색인

`src/infrastructure/coreapi/class-member-index.ts`

```ts
export interface ClassMember {
  name: string; kind: 'method' | 'property';
  signature: string;      // 메서드는 `(param, …)`, 프로퍼티는 빈 문자열
  doc: string;            // phpdoc 첫 문장
  location: SourceLocation;
}
export class ClassMemberIndex implements ClassMemberRepository {
  buildFromRoot(root: string, syntax: PhpSyntax): void;
  buildFromRootAsync(root: string, syntax: PhpSyntax): Promise<void>;
  membersOf(className: string): ClassMember[];
}
```

- **파일 찾기**: 클래스마다 후보 경로 목록을 순서대로 보고, 그 파일 텍스트에 `class <name>` 선언이 있는 첫 번째를 쓴다. 없으면 그 클래스는 빈 목록(침묵).
  | 클래스 | 후보 |
  |---|---|
  | `moodle_database` | `lib/dml/moodle_database.php` |
  | `moodle_page` | `lib/pagelib.php` |
  | `core_renderer` | `lib/classes/output/core_renderer.php`, `lib/outputrenderers.php` |
- **추출**: tree-sitter로 그 파일을 파싱해 대상 클래스 본문의 메서드·프로퍼티 선언을 모은다.
  - `private` 멤버는 제외한다.
  - `protected function magic_get_<name>()`는 **프로퍼티 `<name>`으로 바꿔 담는다**(Moodle 매직 프로퍼티 관례). 그 외 `protected` 메서드는 제외한다.
  - phpdoc은 선언 바로 앞 주석 블록의 첫 문장만 쓴다.
- 코어 파일은 편집 대상이 아니므로 **증분 갱신은 두지 않는다** — 전체 재빌드에서만 다시 읽는다.

파싱 대상이 큰 파일이다(4.5 기준 `moodle_database.php` 122KB, `pagelib.php` 92KB, `core_renderer.php` 195KB). 기존 실측 p90이 15KB에 11ms이므로 세 파일 합계는 100~300ms로 예상된다(구현 후 실측: 파싱 79~86ms에 최대 정지 29~33ms) — **활성화 경로에 넣으면 한 자릿수 ms 목표를 깬다**. 따라서 처음부터 **지연 빌드**로 만든다: 첫 `$DB->`·`$PAGE->`·`$OUTPUT->` 요청에서 한 번 만들고 이후 재사용한다(사용처 색인의 `built()`/`build()` 관례와 같다). 실측이 한 자릿수 ms로 나오면 그때 활성화 빌드로 옮긴다.

`$CFG` 완성 목록은 필터 없이 전부를 준다(실측 config-dist + 설정 선언 949개). 현재 플러그인 문맥으로 좁히는 것은 다음 사이클 후보다.

### 3.4 설정 키 색인

`src/infrastructure/config/config-key-index.ts`

```ts
export class ConfigKeyIndex implements ConfigKeyRepository {
  buildFromRootAsync(root: string): Promise<void>;
  keys(): ConfigKey[];                      // { name, doc, location }
  find(name: string): ConfigKey | undefined;
}
```
- `config-dist.php`의 `$CFG-><name>` 등장 위치(주석에 설명이 붙어 있다 — 그 줄 위의 `//` 블록을 doc으로 쓴다).
- 플러그인·`admin/settings/*.php`의 `new admin_setting_*('<name>' …)`. 이름에 `/`가 있으면 마지막 조각(`plugin/key` → `key`). 열거는 타입 맵을 재사용한다.
- 같은 이름이 여러 곳에 있으면 먼저 찾은 것을 쓴다(정의 이동은 한 곳이면 충분하다).

### 3.4.1 전역이 지역 변수로 가려질 때

`$DB`·`$PAGE`·`$OUTPUT`·`$CFG`는 실코드에서 재대입되지 않지만 `$USER`·`$COURSE`·`$SITE`는 다르다.
```php
foreach ($users as $USER) { … }
$COURSE = $DB->get_record('course_modules', …);
```
이때 전역 경로가 `user`/`course` 컬럼을 주고 레코드 경로가 다른 테이블을 주면 두 목록이 합쳐져 거짓 후보가 섞인다.

**규칙**: `table` 종류는 완성 시 커서 앞의 같은 스코프에 그 이름에 대한 일반 대입(`plainAssignments`)이 있으면 **빈 결과를 주고 레코드 엔진에 넘긴다**. kill-on-reassign이 쓰는 `nearestPreceding`·`sameScope`를 그대로 재사용한다. `class`·`config` 종류는 이 판정을 하지 않는다(재대입이 실코드에 없고, 있더라도 줄 것이 달라지지 않는다).

### 3.5 유즈케이스

| 파일 | 역할 |
|---|---|
| `application/complete-global-members.ts` | `run(text, varName, atIndex): GlobalMemberItem[]` — 세 종류를 한 곳에서 분기. `table` 종류만 §3.4.1의 가림 판정을 위해 `text`·`atIndex`를 쓴다 |
| `application/describe-global-member.ts` | `run(text, atIndex): HoverResult \| null` — 프로퍼티 접근·메서드 호출 양쪽 |
| `application/resolve-global-member-definition.ts` | `run(text, atIndex): DefinitionResult[]` |

전역이 아닌 변수는 세 유즈케이스 모두 빈 결과다(기존 레코드 경로가 담당).

### 3.6 프리젠테이션

새 프로바이더 3종을 php에 등록한다. 기존 레코드 프로바이더와 트리거·언어가 겹치지만, 각자 자기 대상이 아니면 빈 결과를 주므로 VS Code가 합쳐도 충돌하지 않는다. 설정은 추가하지 않는다(하이라이트가 아니라 완성·hover이므로 끌 이유가 없다).

## 4. 테스트 전략

- **전역 표**: 각 전역이 기대한 바인딩을 갖는지(표 자체가 계약).
- **팩트**: `$DB->get_record(…)`가 `methodCalls`에 잡히고 위치가 정확한지, 프로퍼티 접근과 섞이지 않는지.
- **클래스 색인**: 후보 경로 중 클래스가 선언된 파일을 고르는지(첫 후보에 없고 두 번째에 있는 픽스처), `private` 제외, `magic_get_x` → 프로퍼티 `x`, phpdoc 첫 문장, 위치 정확성, 클래스가 없으면 빈 목록.
- **설정 색인**: `config-dist.php`와 `settings.php` 양쪽에서 키를 모으는지, `plugin/key` 형태에서 마지막 조각을 쓰는지, 없는 키는 `undefined`.
- **유즈케이스**: `$DB->` 완성이 메서드 목록을, `$USER->` 완성이 user 컬럼을, `$CFG->` 완성이 설정 키를 주는지. 전역이 아닌 변수는 빈 결과. hover·정의 이동이 메서드 이름 위와 프로퍼티 이름 위에서 각각 동작하는지.
- **회귀**: 기존 277건 녹색 — 특히 레코드 완성이 그대로인지.

## 5. 성공 기준

- `global $DB;` 아래에서 `$DB->get_rec` 입력 시 `get_record`·`get_records`… 가 시그니처와 함께 뜨고, F12가 `moodle_database.php`의 선언 줄로 간다.
- `$PAGE->cont` → `context`(매직 프로퍼티)가 뜬다.
- `$CFG->wwwr` → `wwwroot`가 뜨고 F12가 `config-dist.php`로 간다.
- `$USER->fir` → `firstname`(user 컬럼)이 한국어 설명과 함께 뜬다.
- 진단은 어디에도 붙지 않는다.
- 활성화 색인의 최대 이벤트 루프 정지가 한 자릿수 ms를 유지한다(실측).
- 기존 277건 무회귀, lint/compile 통과, 버전 0.8.0 + CHANGELOG.
