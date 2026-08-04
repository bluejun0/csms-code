# CSMS Code — Plan 2: 언어 문자열 인텔리전스 설계

- **작성일**: 2026-08-04
- **작성자**: Claude (jun0@bluesoft.co.kr — 범위(4기능 전부)·설계 승인 후 "완성까지 알아서" 위임)
- **상태**: 설계 확정 — 구현 계획 작성 단계
- **선행 문서**: `2026-07-23-csms-code-extension-design.md` §Plan 2, `docs/PHASE2-BACKLOG.md` §Plan 2

---

## 1. 배경과 목표

### 실측 (hlulxp 기준)
- `get_string(` **5,274건**(local 커스텀만) — Phase 1의 DB 패턴(수백 건)보다 훨씬 큰 표면.
- lang 파일: `$string['key'] = '값';` 형태, 커스텀 플러그인 다수가 `lang/ko` 보유(한국어 값), 코어는 저장소에 `lang/en/*.php` 79개만(ko 언어팩은 moodledata — 저장소 밖).
- `get_strings(` 0건, `new lang_string(` 6건, `addHelpButton(` 12건 → **get_string만 지원**(비목표 참고).

### 목표 — 4기능 (사용자 확정)
`get_string('key', 'component')`의 **key** 위치에서:
1. **자동완성**: component의 키 목록 + 한국어 값 미리보기
2. **정의로 이동**: lang 파일의 `$string['key']` 줄로 (ko·en 둘 다 있으면 두 위치)
3. **hover**: 한국어 값 우선 + 영어 값
4. **누락 진단**: component가 색인에 **있는데** key가 없으면 경고 + 가장 가까운 키 제안

### 비목표(YAGNI)
- `get_strings`/`new lang_string`/`addHelpButton`/AMD `core/str` — 실측상 미미, 후속.
- component 이름 자체의 완성/검증.
- double-quoted·heredoc lang 값, escape 포함 문자열 키 — 관례 밖(제한 기록).
- en·ko 외 locale, 코어 ko(저장소에 없음 — hover는 코어에서 en만).
- 비동기 색인 — 백로그 5번에서 DB 색인과 일괄(5번 문구에 문자열 색인 포함하도록 갱신).

## 2. 아키텍처 — 접근 A (기존 파이프라인 재사용)

DB 인텔리전스와 대칭 구조. `stringCalls` 팩트는 `DocumentFacts`에 추가되어 **파싱 캐시(LRU)·진단 debounce를 공짜로** 얻는다. `scopeContaining`의 타입 가드(`'scope' in x`)가 scope 없는 `StringCall`을 자연 제외 — 12번 하드닝이 설계대로 방어하는 첫 사례.

```
[lang/*/*.php] → LangFileParser → StringIndexStore(=StringRepository) ←─┐
[PHP 문서] → TreeSitterPhpSyntax(stringCalls 팩트 추가) → 유즈케이스 4개 ─┘ → 프로바이더 4개
```

### 2.1 도메인 (`src/domain/lang-model/`)
```ts
// lang-string.ts
export interface LangEntry { value: string; location: SourceLocation; }
export interface LangString { key: string; ko?: LangEntry; en?: LangEntry; }
// ports/string-repository.ts
export interface StringRepository {
  getString(component: string, key: string): LangString | undefined; // component는 raw — 구현이 정규화
  keysOf(component: string): LangString[];
  hasComponent(component: string): boolean;
}
// services/string-validator.ts — closestColumn과 대칭
export function closestKey(keys: string[], key: string, maxDistance = 3): string | undefined
```

### 2.2 팩트 (`facts.ts` + tree-sitter)
```ts
export interface StringCall {
  key: string; component: string;
  keyLine: number; keyColumn: number; keyIndex: number; // key 리터럴 내용의 정확한 위치(진단 range·커서 판정용)
  index: number; // 호출 시작
}
// DocumentFacts.stringCalls: StringCall[] (필수 필드 — 생성처 3곳 갱신: 어댑터, inference.test base, cached-php-syntax.test CountingFake)
```
쿼리(Q_DATAARG 선례 — 함수명 필터는 캡처 후 코드에서):
```
(function_call_expression
  function: (name) @fn
  arguments: (arguments
    . (argument (string (string_content) @key))
    . (argument (string (string_content) @component))))
```
`fn === 'get_string'`만 채택. **변수 키/컴포넌트·문자열 보간은 매칭 자체가 안 됨 → 자연 침묵(오탐 원천 차단).** 3번째 인자(`$a`)가 있어도 선두 anchor 2개로 매칭(기존 dataarg에서 검증된 방식).

### 2.3 색인 (infrastructure)
- **파서** `parseLangFile(text, uri): { key; value; line }[]` — 정규식
  `/\$string\[\s*'((?:[^'\\]|\\.)+)'\s*\]\s*=\s*'((?:[^'\\]|\\.)*)'\s*;/g`,
  값의 `\'`·`\\` unescape, 여러 줄 값 지원, line은 매치 앞 개행 수.
- **열거** `listLangFiles(root): { file; component; locale }[]` (moodle-root-resolver에 추가):
  - 코어: `lang/en/<base>.php` → component = `base === 'moodle' ? 'core' : 'core_<base>'`
  - 플러그인: `<type>/<name>/lang/<locale>/<expected>.php`, locale ∈ {en, ko},
    **expected = type이 'mod'면 `<name>.php`, 아니면 `<type>_<name>.php`** (Moodle 규칙), component = `<type>_<name>`
  - 플러그인 이름 열거는 기존 `safeReaddir` 재사용(symlink 지원 승계)
- **StringIndexStore** `implements StringRepository`: canonical component(`core`, `core_grades`, `mod_assign`, `local_ubattend`)로 저장. **조회 시 raw 정규화**(fs 불필요 — 색인 존재로 판정):
  `''|'moodle'|'core'` → `core`; `_` 포함 → 그대로; bare `xxx` → `core_xxx`가 색인에 있으면 그것, 아니면 `mod_xxx`(레거시 단축). 편집거리 제안은 기존 `levenshtein` 재사용(`closestColumn`과 대칭인 `closestKey`). `parseFrankenstyle` dead code는 이 정규화에 맞지 않아 결선하지 않음(백로그 7번에 그대로 남김).
- watcher: `**/lang/*/*.php` 변경 시 전체 재색인(DB 색인과 동일 단순화).

### 2.4 유즈케이스 (application)
| 유즈케이스 | 시그니처 | 비고 |
|---|---|---|
| `CompleteStringKeys` | `run(component): StringItem[]` | component는 프로바이더가 정규식으로 추출(미완성 코드 대응) |
| `ResolveStringDefinition` | `run(text, atIndex): DefinitionResult[]` | 커서가 stringCall.key 범위 안일 때 ko·en 위치 배열 |
| `DescribeString` | `run(text, atIndex): HoverResult \| null` | `**component / key**` + ko 값 + en 값 |
| `ValidateStringKeys` | `run(text): DiagnosticItem[]` | `hasComponent(c) && !getString(c,k)` → 경고 + `closestKey` 제안. component 미색인이면 침묵 |
DTO 추가: `StringItem { key: string; ko?: string; en?: string; }`. 기존 `DiagnosticItem`/`DefinitionResult`/`HoverResult` 재사용.

### 2.5 프레젠테이션·결선
- `StringKeyCompletionProvider`: 커서 앞 `/get_string\(\s*['"]([\w:.\/-]*)$/` + 커서 뒤 `/^[^'"]*['"]\s*,\s*['"](\w+)['"]/`로 component 추출 — component 미확정이면 `[]`. 트리거 문자 `'`·`"` 추가.
- `StringDefinitionProvider`(Location[] 반환)·`StringHoverProvider`: 기존 record 프로바이더 패턴 그대로.
- **진단 합류**: `registerDiagnostics(ctx, validate, validateStrings)` — refresh가 두 유즈케이스 결과를 concat해 같은 컬렉션에 set. 설정은 기존 `csmscode.diagnostics.enable` 하나로.
- `extension.ts`: `StringIndexStore` 생성 + `buildFromRoot(root)` + lang watcher + 프로바이더 3개 등록 + validate 결선.

## 3. 테스트 전략
- **파서**: 기본/이스케이프(`\'`)/여러 줄 값/라인 위치/`{$a}` 보존.
- **열거·색인**: mini-moodle 픽스처에 lang 파일 추가(코어 `lang/en/moodle.php`, `local/ubattend/lang/{en,ko}/local_ubattend.php`, mod 예외 검증용 `mod/testmod/lang/en/testmod.php`) — 컴포넌트·locale 정확성, ko/en 병합, 정규화(`''`/`moodle`/`core_grades`/bare 레거시).
- **팩트**: 리터럴 호출 추출·key 위치 정확성·변수 키 비매칭·3번째 인자 허용·`get_string` 아닌 함수 제외.
- **유즈케이스**: fake StringRepository로 4개 각각 + 실파서 E2E 1건(누락 키 진단).
- **회귀**: `DocumentFacts` 필수 필드 추가에 따른 생성처 3곳 갱신 후 기존 78건 녹색. scopeContaining 타입 가드가 scope 없는 StringCall을 제외하는지는 기존 완성 테스트 녹색이 증명.

## 4. 성공 기준
- 4기능이 유즈케이스 레벨에서 테스트로 재현(누락 진단은 실파서 E2E 포함).
- 기존 78건 무회귀 + 신규 ~25건, lint/compile/test-tsc 통과.
- README·manual-verification에 문자열 기능 추가, 백로그 Plan 2 완료 반영.
