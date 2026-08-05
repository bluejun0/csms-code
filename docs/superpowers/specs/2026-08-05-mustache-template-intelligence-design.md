# CSMS Code — Mustache 템플릿 인텔리전스 + 플러그인 디렉터리 매핑 수정 설계

- **작성일**: 2026-08-05
- **작성자**: Claude (jun0@bluesoft.co.kr — 범위(이동+참조+하이라이트+block 버그) 확정 후 위임)
- **상태**: 설계 확정 — 구현 계획 작성 단계
- **선행 문서**: `2026-08-05-lang-references-highlight-design.md`, `2026-08-04-lang-string-intelligence-design.md`

---

## 1. 배경

### 1a. 요청 — 템플릿도 문자열처럼
`$OUTPUT->render_from_template('local_ubattend/setting', $data)`에서 `.mustache` 파일로 **정의 이동**,
그리고 `.mustache` 파일에서 **참조 이동**(사용처 목록). 실측(hlulxp): `render_from_template` 458건
(리터럴 445 / 동적 10), 수신자는 `$OUTPUT->` 454 + 기타 4(`$this->` 0건). 템플릿 파일 2,951개.

구조상 유의점 둘:
- **이름에 하위 경로가 흔함**: `local_ubattend/svg/icon/hyflex` → `local/ubattend/templates/svg/icon/hyflex.mustache` (local에만 421개)
- **테마 오버라이드**: `theme/coursemos/templates/local_ubattend/foo.mustache`가 `local_ubattend/foo`를 덮어씀

### 1b. 발견 — 플러그인 타입 20개가 색인되지 않고 있음
`PLUGIN_TYPES`는 타입명을 그대로 디렉터리명으로 쓴다(`root/<type>/`). 실제 Moodle 디렉터리와 대조한
결과(27개 실측 검증), **평면·동명인 10개만 맞고 나머지 20개는 전부 빗나간다**:

| 상태 | 타입 |
|---|---|
| 정상(동명) | mod, local, report, enrol, auth, theme, filter, repository, portfolio, webservice |
| **이름 불일치** | **block → `blocks/`** (hlulxp에 46개 플러그인) |
| **중첩 경로** | tool→`admin/tool`(41), qtype→`question/type`(21), format→`course/format`(11), gradereport→`grade/report`(7), gradeexport→`grade/export`(4), gradeimport→`grade/import`(3), message→`message/output`(4), availability→`availability/condition`(6), customfield→`customfield/field`(6), contenttype→`contentbank/contenttype`(1), profilefield→`user/profile/field`(6), datafield→`mod/data/field`(12), datapreset→`mod/data/preset`(4), cachestore→`cache/stores`(5), cachelock→`cache/locks`(1), editor→`lib/editor`(8), atto→`lib/editor/atto/plugins`(32), mlbackend→`lib/mlbackend`(2) |

즉 **이미 배포된 DB·언어 문자열 기능에서 이 플러그인들의 install.xml·lang 파일이 한 번도 색인된 적이
없다.** 템플릿 색인이 같은 열거를 재사용하므로 여기서 함께 고친다. 이는 백로그 6번(nested subplugin
색인)의 대부분을 닫는다.

### 비목표(YAGNI)
- JS/AMD `Templates.render()`(43건) — 별도 파서 표면, 후속.
- 템플릿 이름 자동완성, `.mustache` 내부(파샬 `{{> x }}`·변수) 인텔리전스.
- 동적 인자(`render_from_template($name, …)` 10건) — 리터럴만, 자연 침묵.
- 코어 서브시스템 템플릿(`grade/templates` 등 — 플러그인 아님): 경로 역산 규칙 밖 → 침묵, 제한 기록.
- 미저장 편집 반영(참조 색인은 저장 기준 — 기존과 동일).

---

## 2. 아키텍처

기존 언어 문자열 세트와 대칭. **핵심 판단: 사용처 스캔은 새로 만들지 않고 기존 것에 합친다** —
`StringUsageIndex`를 `PhpUsageIndex`로 확장해 파일 한 번 읽을 때 `get_string`과 `render_from_template`을
동시에 추출한다. 23초 스캔이 두 번 도는 일이 없고, 첫 Shift+F12가 어느 쪽이든 양쪽 색인이 채워진다.

### 2.1 플러그인 디렉터리 매핑 (`moodle-root-resolver.ts`)
`PLUGIN_TYPES: string[]`를 `PLUGIN_DIRS: Record<type, relDir>`로 교체(실측 검증된 30개 항목).
열거 함수 3곳(`listInstallXmlFiles`, `listLangFiles`, 신규 템플릿 열거)이 `path.join(root, relDir, name)`을 사용.

역산(`componentOfLangFile`, 신규 `componentOfTemplateFile`)은 세그먼트 개수 가정 대신 **`PLUGIN_DIRS`
항목을 순회하며 `rel`이 `<relDir>/<plugin>/…` 형태인지 검사**한다(다중 세그먼트 디렉터리 대응).
매칭이 여럿일 때는 **가장 긴 relDir 우선**(예: `mod/data/field/x/…`는 `datafield`이지 `mod`가 아님).

### 2.2 템플릿 색인 (`TemplateIndex`, infrastructure)
```ts
export interface TemplateRef { component: string; name: string; }          // name은 하위 경로 포함 가능
export interface TemplateRepository {
  locationsOf(component: string, name: string): SourceLocation[];          // 원본 + 테마 오버라이드
  has(component: string, name: string): boolean;
}
export class TemplateIndex implements TemplateRepository {
  buildFromRoot(root: string): void;                                        // 동기(기존 색인들과 동일 — 비동기화는 백로그 5번)
}
```
경로 → `component/name` 역산 규칙(파일 스캔이 단일 진실 — 컴포넌트→디렉터리 역방향 표 불필요):
1. `lib/templates/<rest>.mustache` → `core` / `<rest>`
2. `theme/<t>/templates/<seg1>/<rest>.mustache` — `<seg1>`이 컴포넌트꼴(`_` 포함 또는 `core`)이면
   **오버라이드**: 컴포넌트 `<seg1>`, 이름 `<rest>`. 아니면 `theme_<t>` / `<seg1>/<rest>`
3. `<relDir>/<plugin>/templates/<rest>.mustache` → `<type>_<plugin>` / `<rest>` (2.1의 매핑·최장일치)
4. 그 외 → 무시(코어 서브시스템 등)

같은 `component/name`에 여러 파일이면 **모두 보관** — 정의 이동이 원본+오버라이드를 함께 반환
(문자열의 ko/en과 동일한 그림). 위치는 `{ uri, line: 0, column: 0 }`.
watcher: `**/templates/**/*.mustache` 변경 시 전체 재색인(기존 두 워처와 동일 단순화).

### 2.3 팩트 (`templateCalls`)
```ts
export interface TemplateCall { ref: string; refLine: number; refColumn: number; refIndex: number; index: number; }
// DocumentFacts.templateCalls: TemplateCall[] — scope 없음(scopeContaining 타입 가드가 제외)
```
tree-sitter 쿼리(멤버 호출, 수신자 무관 — `$OUTPUT`·`$this`·기타 모두 매칭):
```
(member_call_expression
  name: (name) @method
  arguments: (arguments . (argument (string (string_content) @ref))))
```
`method.text === 'render_from_template'`만 채택(Q_DATAARG 선례대로 코드 필터). 위치는 `string_content`
기준. `ref`는 `component/name` 통짜 문자열 — 분해는 도메인 `parseTemplateRef`가 담당
(`'a/b/c'` → `{component:'a', name:'b/c'}`, `/` 없으면 null → 침묵).

### 2.4 사용처 색인 확장 (`PhpUsageIndex`)
`StringUsageIndex` → `PhpUsageIndex`로 이름 변경 후:
- 스캔 루프에서 정규식 2개 적용(`USAGE_RE` 기존 + `TEMPLATE_USAGE_RE = /render_from_template\(\s*['"]([\w:.\/-]+)['"]/g`)
- 두 번째 맵 `byTemplateRef: Map<string, SourceLocation[]>` + `templateRefsOf(component, name): SourceLocation[]`
- `updateFileText`/삭제 증분·`isIndexablePhpPath`·realpath 가드는 그대로 공유(파일 단위 교체가 두 맵 모두 커버)

### 2.5 유즈케이스·프레젠테이션
| 구성요소 | 내용 |
|---|---|
| `ResolveTemplateDefinition` (app) | `run(text, atIndex): DefinitionResult[]` — 커서가 ref 리터럴 범위 안 → 템플릿 파일 위치(복수 가능) |
| `FindTemplateReferences` (app) | `run(component, name): SourceLocation[]` — 포트 위임 |
| `ListResolvedTemplateCalls` (app) | `run(text): RangeItem[]` — 색인에 존재하는 ref의 범위(하이라이트용) |
| `TemplateDefinitionProvider` (php) | `Location[]` 반환. 기존 `StringDefinitionProvider`와 병존(둘 다 등록해도 VS Code가 합침) |
| `TemplateReferenceProvider` | 셀렉터 `{ scheme:'file', pattern:'**/templates/**/*.mustache' }`(language 미지정 — mustache 언어 ID 미보장). `componentOfTemplateFile`로 역산 → 미빌드면 진행률과 함께 lazy 빌드(문자열과 공유) |
| 하이라이트 | 기존 `registerStringHighlight`를 **범위 공급자 배열**을 받도록 일반화(`registerResolvedHighlight(ctx, [listResolvedStrings, listResolvedTemplates])`)해 데코레이션·디바운서를 하나로 유지. 설정 `csmscode.templates.highlightResolved`(기본 true) 추가 |
| `extension.ts` | TemplateIndex 생성·빌드, 템플릿 워처, 프로바이더 2개 등록, 하이라이트 일반화 결선 |

## 3. 테스트 전략
- **매핑/역산**: `PLUGIN_DIRS`로 blocks·admin/tool·mod/data/field 등 열거, 최장일치(`mod/data/field/x` → datafield), 기존 lang 역산 무회귀.
- **템플릿 색인**: 코어(`lib/templates`), 플러그인, 중첩 이름(`svg/icon/x`), 테마 오버라이드 복수 반환, theme 자체 템플릿, 규칙 밖 무시.
- **팩트**: `$OUTPUT->`·`$this->`·기타 수신자 모두 추출, 동적 인자 비추출, 위치 정확성, `render_from_template` 아닌 메서드 제외.
- **`parseTemplateRef`**: 정상/슬래시 없음(null)/다중 슬래시.
- **`PhpUsageIndex`**: 한 번의 스캔이 문자열·템플릿 참조를 모두 채우는지, 증분 교체가 두 맵 모두 반영하는지.
- **유즈케이스 E2E**: 실파서+실색인으로 정의(오버라이드 복수)·참조·해석 범위.
- **회귀**: 기존 128건 녹색(특히 `PLUGIN_DIRS` 교체 후 기존 열거 테스트).

## 4. 성공 기준
- PHP에서 템플릿 리터럴 F12 → `.mustache`(오버라이드 있으면 복수), `.mustache`에서 Shift+F12 → 사용처 목록, 해석 ref 하이라이트 — 유즈케이스 레벨 재현.
- `PLUGIN_DIRS` 도입으로 block(46)·tool(41) 등 플러그인의 install.xml·lang이 색인됨을 테스트로 실증.
- 기존 128건 무회귀 + 신규 ~28건, lint/compile/test-tsc 통과, 문서·백로그 갱신(6번 부분 완료 반영).
