# CSMS Code — JS/AMD 인텔리전스 설계

- **작성일**: 2026-08-05
- **작성자**: Claude (jun0@bluesoft.co.kr — 범위(이동·hover·참조·하이라이트, 진단 제외) 확정 후 위임)
- **상태**: 설계 확정 — 구현 계획 작성 단계
- **선행 문서**: `2026-08-05-mustache-template-intelligence-design.md`, `2026-08-04-lang-string-intelligence-design.md`

---

## 1. 배경과 목표

### 실측 (hlulxp `local/` JS)
| 호출 | 건수 |
|---|---|
| `M.util.get_string(` (레거시 YUI 전역) | 666 |
| `<모듈>.get_string(` (core/str AMD) | ~168 |
| `getString(` (신형 named export) | 8 |
| `Templates.render(` | 31 |
| `renderForPromise(` (12는 `Templates.` 접두) | 23 |

문자열 호출이 압도적이고, PHP와 **인자 순서가 동일**(`(key, component)`, `('component/name')`)하다.

### 함정 두 가지 (실측 확인)
1. **`amd/build/`는 `amd/src/`의 미니파이 복사본** — `local/`에서 193:193 대응, 저장소 전체 `amd/build` JS 1,203개·`.min.js` 1,255개. 스캔에 넣으면 모든 참조가 중복되고 생성 파일로 점프한다. **반드시 제외.**
2. **JS용 tree-sitter 문법이 없다** — 현재 번들은 PHP WASM만. 새 문법 추가는 번들 크기·복잡도 비용이 크다.

### 결정 — JS는 정규식 스캔
AST 없이 정규식으로 처리한다. 근거: 사용처 색인이 이미 정규식이고 완성 프로바이더도 정규식 선례이며, JS 호출 형태가 단순하고 수신자가 다양(`M.util.` / `<모듈>.` / 없음)해 정규식이 오히려 잘 맞는다. 대가는 AST가 없어 **주석·문자열 리터럴 안의 호출도 인식**되는 것 — 그래서 **진단은 비목표**(사용자 확정): 잘못된 경고보다 침묵이 낫다. 이동/hover/참조/하이라이트는 오인식되어도 "없는 곳으로 안 가고 아무것도 안 뜨는" 수준이라 안전하다.

### 목표 (4종, 사용자 확정)
JS 파일에서: **정의 이동**(문자열 키→lang 파일, 템플릿 ref→.mustache), **hover**(한국어 값 / 템플릿 위치), **하이라이트**(해석되는 참조), 그리고 lang·.mustache 파일의 **Shift+F12 결과에 JS 호출처 포함**.

### 비목표(YAGNI)
- JS 진단(위 근거), JS 자동완성, `getStrings([...])` 배열 형태(실측 1건), `prefetchTemplate`/`prefetchStrings`(0건), `.min.js`·`amd/build` 색인, TypeScript(`.ts`) 소스, JS AST 도입.

---

## 2. 아키텍처

기존 자산 재사용이 핵심 — 새 색인은 만들지 않는다. `StringIndexStore`·`TemplateIndex`는 그대로 쓰고, JS는 **문서 스캐너**와 **사용처 스캔 확장**만 추가한다.

### 2.1 JS 호출 스캐너 (`src/domain/code-analysis/js-call-scanner.ts`)
vscode·fs 무의존 순수 함수 — 유닛 테스트 대상. **도메인에 두는 이유**: eslint 계층 규칙이 application의
`*/infrastructure/*` import를 금지하는데(§2.3의 유즈케이스 3개가 이 함수를 직접 쓴다), 이 스캐너는 외부
의존이 전혀 없는 텍스트 분석이라 도메인 규칙(node·vscode·infrastructure 금지)을 그대로 만족한다.
PHP 팩트 추출이 infrastructure인 것은 WASM 의존 때문이며, 여기엔 해당하지 않는다.
```ts
export interface JsStringCall { key: string; component: string; keyLine: number; keyColumn: number; keyIndex: number; }
export interface JsTemplateCall { ref: string; refLine: number; refColumn: number; refIndex: number; }
export interface JsCalls { stringCalls: JsStringCall[]; templateCalls: JsTemplateCall[]; }
export function scanJsCalls(text: string): JsCalls;
```
정규식(둘 다 홑·겹따옴표 모두 허용 — JS는 겹따옴표가 흔하다):
```ts
// M.util.get_string / <모듈>.get_string / getString 모두 — \b가 '.' 뒤에서도 성립
const JS_STRING_RE = /\b(?:get_string|getString)\s*\(\s*(['"])([\w:.\-/]+)\1\s*,\s*(['"])(\w+)\3/g;
// Templates.render / renderForPromise / 구조분해된 render — ref에 '/'를 요구해 오탐을 거른다
const JS_TEMPLATE_RE = /\brender(?:ForPromise)?\s*\(\s*(['"])([\w.\-]+\/[\w.\-/]+)\1/g;
```
라인·컬럼은 **증분 카운트**(O(n²) 금지 — 기존 교훈). 위치는 리터럴 **내용** 시작(여는 따옴표 다음).

### 2.2 사용처 색인 확장 (`PhpUsageIndex`)
클래스명 유지(이미 두 종류를 담당). 변경점:
- 파일 열거를 `.php` + `.js`로 확장하되 **제외 규칙 강화**: `amd/build` 세그먼트 쌍, `.min.js`.
- **콜드 스캔과 저장 증분이 같은 술어를 쓴다** — 지난 사이클의 Important 발견(패리티 부재로 유령 참조 주입)을 구조적으로 방지:
  ```ts
  export function isIndexableSourcePath(root: string, fsPath: string): boolean; // .php|.js, 루트 안, SKIP_DIRS·amd/build·.min.js 제외
  ```
  콜드 스캔의 walk도 이 술어로 파일을 거른다(기존 `isIndexablePhpPath`는 이 함수로 대체, 호출부 갱신).
- `updateFileText(uri, text)`가 확장자로 분기: `.php` → 기존 PHP 정규식 2종, `.js` → `scanJsCalls`. 두 경우 모두 **같은 두 맵**(`byComponent`, `byTemplateRef`)에 적재하므로 참조 조회는 언어 구분 없이 통합된다.

### 2.3 유즈케이스 (application) — 종류별이 아닌 기능별 1개씩
JS 파일 한 곳에 문자열·템플릿 호출이 섞이므로, 커서 위치로 둘 중 무엇인지 판정하는 책임을 유즈케이스에 둔다.
| 유즈케이스 | 시그니처 | 동작 |
|---|---|---|
| `ResolveJsDefinition` | `run(text, atIndex): DefinitionResult[]` | 커서가 문자열 키 안 → lang 위치(ko·en), 템플릿 ref 안 → .mustache 위치(오버라이드 포함). 아니면 `[]` |
| `DescribeJsSymbol` | `run(text, atIndex): HoverResult \| null` | 문자열: `**comp / key**` + ko/en 값. 템플릿: `**comp / name**` + 파일 경로 목록 |
| `ListResolvedJsCalls` | `run(text): RangeItem[]` | 색인에 존재하는 문자열 키·템플릿 ref의 범위 |
생성자는 셋 다 `(strings: StringRepository, templates: TemplateRepository)`. `scanJsCalls`는 도메인 모듈 함수로 직접 import한다(포트로 감쌀 만큼 교체 가능성이 없고, 도메인이라 계층 규칙에도 걸리지 않는다).

### 2.4 프레젠테이션
- `JsDefinitionProvider`·`JsHoverProvider` — 셀렉터 `{ language: 'javascript', scheme: 'file' }`.
- 하이라이트: `HighlightSource`에 `languages: string[]` 추가하고 `refresh`가 `doc.languageId`로 필터. 기존 두 소스는 `['php']`, 신규 JS 소스는 `['javascript']`. 데코레이션·디바운서는 계속 하나. 설정은 기존 두 개 재사용(문자열/템플릿 각각) — JS 전용 설정은 만들지 않는다(같은 개념을 두 벌 노출하지 않기 위해).
  → `refresh`의 php 하드코딩 가드와 `onDidChangeTextDocument` 가드도 `['php','javascript']` 기반으로 일반화.
- `package.json`: `activationEvents`에 `onLanguage:javascript` 추가.
- 저장 증분 핸들러: `d.languageId === 'php'` 조건을 제거하고 `isIndexableSourcePath`만으로 판정(확장자가 이미 언어를 결정).

## 3. 테스트 전략
- **스캐너**(순수 함수, 신규 파일): `M.util.get_string`·`util.get_string`·`getString` 3형태 추출, 겹따옴표, 템플릿 `Templates.render`·구조분해 `render`·`renderForPromise`, `/` 없는 ref 비추출, 위치(줄·컬럼·index) 정확성, 여러 줄에 걸친 증분 라인 계산.
- **제외 술어**: `amd/build` 경로·`.min.js`·루트 밖·비대상 확장자 → false; `amd/src` js·일반 php → true.
- **사용처 색인**: JS 픽스처를 추가해 한 번의 스캔이 PHP·JS 참조를 모두 담는지, 저장 증분이 JS 파일도 교체하는지, `amd/build` 사본이 색인되지 않는지(중복 0).
- **유즈케이스 E2E**: 실색인 + 실제 JS 텍스트로 정의(문자열·템플릿 각각)·hover·해석 범위, 커서가 리터럴 밖이면 빈 결과.
- **회귀**: 기존 158건 녹색(특히 `isIndexablePhpPath` → `isIndexableSourcePath` 교체 후 기존 사용처 테스트).

## 4. 성공 기준
- JS에서 문자열 키·템플릿 ref에 F12·hover 동작, 해석 참조 하이라이트, lang/.mustache의 Shift+F12에 JS 호출처 포함 — 유즈케이스 레벨 재현.
- `amd/build`·`.min.js`가 참조 목록에 나타나지 않음을 테스트로 실증.
- 기존 158건 무회귀 + 신규 ~25건, lint/compile/test-tsc 통과, 문서·백로그 갱신.
