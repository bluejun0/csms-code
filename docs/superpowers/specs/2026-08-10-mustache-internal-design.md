# CSMS Code — Mustache 내부 인텔리전스

- **작성일**: 2026-08-10
- **상태**: 설계 확정 — 구현 계획 작성 단계
- **요청**: "mustache에서 역으로 참조되는 곳을 찾을 수 있나", "mustache에서 mustache로 참조 이동도 안 되는데", "`{{#str}}`으로 string 조회하는 것도 안 돼"

---

## 1. 배경

`.mustache` 파일은 지금 **바깥에서 자기를 부르는 PHP·JS만** 찾을 수 있다(Shift+F12). 파일 안의 내용은 아무것도 해석하지 않는다 — 템플릿 인텔리전스 사이클에서 "`.mustache` 내부"를 비목표로 뒀기 때문이다.

### 실측 (hlulxp)

| 항목 | 전체 | 커스텀(`local`·`theme/coursemos`·`blocks`) |
|---|---|---|
| `{{#str}}` | 9,525 | **4,312** |
| `{{#cleanstr}}` | 51 | — |
| `{{> comp/name}}` (partial) | 2,882 | 991 (그중 `theme_coursemos` 대상 806) |
| `{{< comp/name}}` (parent) | 337 | — |
| `.mustache` 파일 | 2,953 | — |
| 그중 컴포넌트로 **역산되는 것** | 2,510 (85.0%) | — |

역산 실패 443개는 전부 **코어 서브시스템 템플릿**이다: `message/templates` 75 · `lib/form` 66 · `course/format` 49 · `admin/templates` 41 · `grade/templates` 35 · `calendar/templates` 30 …

`lib/components.json`의 `subsystems`가 규칙을 준다 — 키 `grades` → 디렉터리 `grade` → 컴포넌트 `core_grades`. 실제 호출도 `render_from_template('core_grades/status_icons')`로 이 규칙과 맞는다. AMD 색인은 이미 이 방식을 쓰고 있고 템플릿만 빠져 있다.

## 2. 목표

1. `.mustache` 안의 `{{> comp/name}}`·`{{< comp/name}}`에서 **F12로 그 템플릿 파일로 이동**하고, 해석되는 참조를 하이라이팅한다.
2. `.mustache`의 **Shift+F12(사용처)에 다른 mustache의 partial·parent 참조를 포함**한다 — 지금은 PHP·JS만 나온다.
3. `{{#str}}key, component{{/str}}`(및 `{{#cleanstr}}`)에서 **lang 정의로 이동**하고, hover로 한국어 값을 보고, 해석되는 키를 하이라이팅한다. lang 파일의 Shift+F12에도 mustache 사용처가 포함된다.
4. 코어 서브시스템 템플릿(443개, 15%)을 열거·역산에 포함해 위 세 가지가 그 파일들에서도 동작하게 한다.

### 비목표
- **mustache 진단**. 인자가 변수인 형태(`{{#str}}key, {{component}}{{/str}}`)와 조건부 블록이 섞여 오탐 위험을 따로 재야 한다. 다음 사이클.
- `{{#pix}}`(832)·`{{#js}}`(457)·`{{#userdate}}`(62), `{{$block}}`/`{{/block}}` 블록 구조, mustache 변수(`{{name}}`)와 PHP 컨텍스트의 연결.
- `.mustache` 자동완성(템플릿 이름·문자열 키).

## 3. 설계

### 3.1 Mustache 스캐너 (도메인)

`src/domain/code-analysis/mustache-scanner.ts` — JS 스캐너와 같은 자리·같은 성질(AST 없이 정규식, 위치는 증분 계산). 도메인에 두는 이유도 같다: 애플리케이션이 인프라를 임포트할 수 없다.

```ts
export interface MustacheRefs {
  templateRefs: { ref: string; line: number; column: number; index: number }[]; // {{> }} · {{< }}
  stringRefs: { key: string; component: string; keyLine: number; keyColumn: number; keyIndex: number }[];
}
export function scanMustache(text: string): MustacheRefs;
```
- 템플릿: `/\{\{[><]\s*([\w.-]+\/[\w.\-/]+)\s*\}\}/g` — 슬래시를 요구한다. 컴포넌트 없는 상대 참조(`{{> footer}}`)는 **실측 0건**이라(슬래시 있는 것 2,878 대 0) 파일 자신의 컴포넌트로 해석하는 경로를 만들지 않는다.
- 문자열: `/\{\{#(?:clean)?str\}\}\s*([\w:.\-\/]+)\s*,\s*(\w+)/g` — 닫는 `{{/str}}`까지 요구하지 않는다(여는 태그와 두 인자만으로 충분하고, 여러 줄에 걸친 형태도 잡힌다). 인자가 변수면 매칭되지 않아 자연히 침묵한다.
- 위치는 한 번의 순회로 누적 계산한다(매치마다 앞을 되짚지 않는다).

### 3.2 코어 서브시스템 템플릿

`componentOfTemplateFile`과 `listTemplateFiles(+Async)`에 서브시스템을 더한다 — `coreSubsystemDirs(root)`의 각 `<dir>/templates/**`를 컴포넌트 `core_<키>`로. 기존 규칙(플러그인·`lib/templates`·테마 오버라이드)은 그대로 두고 **뒤에 덧붙이는** 형태라 기존 해석이 바뀌지 않는다.

주의: 디렉터리가 겹친다. `course` 서브시스템의 디렉터리는 `course`이고 `format` 플러그인 타입의 디렉터리는 `course/format`이다. 역산은 **더 긴 경로가 이긴다**(기존 `pluginTypeOfRel`의 최장 매치와 같은 원칙) — `course/format/topics/templates/x`는 `format_topics`, `course/format/templates/x`는 `core_courseformat`, `course/templates/x`는 `core_course`.

### 3.3 사용처 색인에 mustache 포함

`PhpUsageIndex`는 이미 PHP와 JS를 함께 훑으므로 이름이 맞지 않는다 — **`UsageIndex`로 바꾼다**. `isIndexableSourcePath`에 `.mustache`를 더하고, `updateFileText`가 확장자로 추출기를 고르는 기존 분기에 mustache를 추가한다. 추출 결과는 기존 두 저장소(문자열 사용처·템플릿 사용처)에 그대로 들어가므로 참조 조회 쪽은 손대지 않는다. 문자열 사용처의 component는 **PHP 경로와 같이 `normalizeComponent`를 통과시킨다** — 빠뜨리면 정규화가 필요한 컴포넌트(`grades`↔`core_grades`)에서 lang 쪽 Shift+F12가 mustache 호출처를 놓친다.

**이름은 이 사이클에서 바꾸지 않는다.** `PhpUsageIndex`가 PHP·JS·mustache를 모두 훑게 되어 이름이 맞지 않지만, 추출 로직을 고치는 커밋에서 광범위한 rename을 함께 하면 диф가 커져 실수가 묻힌다. 별도 커밋으로 미룬다.

### 3.4 유즈케이스

| 파일 | 역할 |
|---|---|
| `application/resolve-mustache-definition.ts` | `run(text, atIndex): DefinitionResult[]` — 커서가 partial/parent 참조면 템플릿 위치, `{{#str}}` 키면 lang 위치 |
| `application/describe-mustache-symbol.ts` | `run(text, atIndex): HoverResult \| null` — 문자열 키의 한국어·영어 값 |
| `application/list-resolved-mustache-refs.ts` | `run(text): RangeItem[]` — 해석되는 템플릿 참조와 문자열 키 |

기존 `ResolveStringDefinition`·`DescribeString`은 PHP 팩트(tree-sitter)에 묶여 있어 재사용할 수 없다. 대신 **저장소 포트는 그대로 공유**한다(`StringRepository`·`TemplateRepository`).

### 3.5 프리젠테이션

`.mustache`의 languageId는 사용자가 어떤 확장을 깔았는지에 따라 다르다(`mustache`·`html`·`plaintext`). 따라서 **셀렉터는 언어가 아니라 경로 패턴**으로 등록한다 — 기존 `TemplateReferenceProvider`가 이미 `{ scheme: 'file', pattern: '**/templates/**/*.mustache' }`를 쓴다.

하이라이트도 같은 문제가 있다. 현재 `HighlightSource.languages`는 `doc.languageId`로만 고른다. **`pathSuffix?: string`을 선택 필드로 더한다** — 언어가 맞거나 경로 접미사가 맞으면 적용한다. 기존 여섯 소스와 라우팅 계약 테스트의 형태를 그대로 두고 확장만 한다.

설정은 기존 것을 재사용한다: 템플릿 참조는 `csmscode.templates.highlightResolved`, 문자열 키는 `csmscode.strings.highlightResolved`.

## 4. 테스트 전략

- **스캐너**: `{{> }}`·`{{< }}`·`{{#str}}`·`{{#cleanstr}}` 추출, 공백 변형(`{{>x/y}}`·`{{> x/y }}`), 여러 줄, 변수 인자 비추출, 위치 정확성(여러 줄에서 줄·컬럼), 한 파일에 여러 개.
- **서브시스템 템플릿**: `grade/templates/x.mustache` → `core_grades/x`, `lib/form/…` → `core_form/…`, `course/format/templates/…` → `core_courseformat/…`(플러그인 `format_topics`와 갈리는지), 열거 동기 ≡ 비동기, 왕복.
- **사용처 색인**: mustache 파일의 partial·`{{#str}}`이 각각 템플릿·문자열 사용처로 들어가는지, 파일 갱신 시 중복되지 않는지, `.mustache`가 `isIndexableSourcePath`를 통과하는지.
- **유즈케이스**: 커서가 partial 위·str 키 위·그 밖일 때. 색인에 없는 참조는 빈 결과. 하이라이트는 해석되는 것만.
- **테마 오버라이드 양방향**: 원본과 오버라이드 두 파일이 같은 키를 공유하므로 **어느 쪽에서 Shift+F12를 해도 같은 참조 목록**이 나와야 한다 — mustache 사용처를 추가하면서 한쪽이 빠지기 쉬운 자리라 테스트로 고정한다.
- **회귀**: 기존 325건 녹색. 특히 템플릿 열거의 기존 단언과 하이라이트 라우팅.

## 5. 성공 기준

- `theme/coursemos/templates/foo.mustache`에서 Shift+F12 → PHP·JS 호출처와 **다른 mustache의 `{{> theme_coursemos/foo}}`가 함께** 나온다.
- `{{> local_ubthread/item}}` 위에서 F12 → 그 파일로 이동한다.
- `{{#str}}attendance_book, local_ubattend{{/str}}`의 키 위에서 F12 → lang 파일로, hover → 한국어 값.
- `grade/templates/status_icons.mustache`에서도 위가 동작한다.
- 기존 325건 무회귀, lint/compile 통과, 버전 0.11.0 + CHANGELOG.
