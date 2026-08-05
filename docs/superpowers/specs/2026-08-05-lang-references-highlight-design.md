# CSMS Code — lang→참조 이동 + 해석 키 하이라이팅 설계

- **작성일**: 2026-08-05
- **작성자**: Claude (jun0@bluesoft.co.kr — 색인 시점(lazy)·하이라이트 스타일(링크 색상) 사용자 확정, 이후 완성까지 위임)
- **상태**: 설계 확정 — 구현 계획 작성 단계
- **선행 문서**: `2026-08-04-lang-string-intelligence-design.md` (Plan 2)

---

## 1. 배경과 목표

### 1a. lang → 참조로 이동 (Find All References)
Plan 2는 코드→lang(정의) 방향만 제공한다. 역방향 — lang 파일의 `$string['key']` 줄에서
Shift+F12로 **이 키를 쓰는 모든 `get_string(...)` 호출 위치** — 를 추가한다.

**실측 제약** (hlulxp): PHP 21,723개 / 182MB, 콜드 전체 스캔 23초. → 요청마다 스캔 불가,
**사용처 색인**을 만들고 증분 유지해야 한다. **색인 시점: 첫 참조 요청 시 lazy** (사용자 확정)
— 활성화 비용 0, 첫 Shift+F12에서만 진행률 알림과 함께 빌드, 이후 즉시. 저장 시 그 파일만 증분 재색인.

### 1b. 해석되는 get_string 키 하이라이팅
코드에서 `get_string('key', 'component')`의 key가 색인에서 **해석되면** 키 텍스트를
**`textLink.foreground` 테마 색상**으로 장식(사용자 확정) — "따라갈 수 있는 참조"라는 시각 신호.
누락 키는 기존 경고 물결선, component 미색인은 무표시(침묵 원칙 일관). 설정
`csmscode.strings.highlightResolved`(기본 true)로 끌 수 있다.

### 비목표(YAGNI)
- 코드 쪽(get_string 위)에서의 References — 요청은 lang→코드 방향만.
- CodeLens("N개 참조"), 변수 key/component 호출의 참조 포착(색인 불가 — 침묵).
- 미저장 편집 반영(색인은 저장 시점 기준 — 제한 기록), en·ko 외 locale.

## 2. 아키텍처

### 2.1 정규화 공유 (리팩토링)
`StringIndexStore.normalize`(private)를 도메인 서비스로 추출:
```ts
// src/domain/lang-model/services/component-normalizer.ts
export function normalizeComponent(raw: string, hasCanonical: (c: string) => boolean): string
```
규칙 동일(`''|'moodle'|'core'`→core, `_`포함→그대로, bare→core_<s> 존재 시 그것, 아니면 mod_<s>).
`StringIndexStore`와 신규 `StringUsageIndex`가 공유. 기존 store 테스트가 등가성 핀.

### 2.2 경로 역산
```ts
// moodle-root-resolver.ts에 추가 — listLangFiles 규칙의 역함수 (순수 경로 로직, fs 불필요)
export function componentOfLangFile(root: string, file: string): string | null
```
`<root>/lang/en/<base>.php`→core/core_<base>; `<root>/<type>/<name>/lang/<locale>/<expected>.php`
(type∈PLUGIN_TYPES, locale∈{en,ko}, expected=mod 예외 규칙 일치)→`<type>_<name>`; 그 외 null.

### 2.3 StringUsageIndex (infrastructure)
```ts
export class StringUsageIndex implements StringUsageRepository {
  constructor(hasCanonical: (c: string) => boolean)   // StringIndexStore 색인 존재 판정 주입
  get isBuilt(): boolean
  async buildFromRoot(root: string, onProgress?: (done: number, total: number) => void): Promise<void>
  updateFileText(uri: string, text: string): void     // 저장 시 파일 단위 증분(기존 항목 제거 후 재추출)
  referencesOf(component: string, key: string): SourceLocation[]  // component는 canonical
}
```
- 스캔: 루트 재귀(node_modules/vendor/.git/.superpowers 제외) `*.php`, 파일별 정규식
  `get_string\(\s*['"]([\w:.\/-]+)['"]\s*(?:,\s*['"](\w+)['"])?` — component 없으면(한 인자) `core`,
  있으면 `normalizeComponent`로 canonical 귀속(레거시 `'assign'`→mod_assign).
- 라인 계산은 **증분 카운트**(Plan 2 최종 리뷰의 O(n²) 교훈 적용).
- 비동기: `fs.promises` + N파일마다 이벤트 루프 양보(`setImmediate`). 진행률 콜백은 vscode 무관(테스트 가능).
- 도메인 포트: `StringUsageRepository { referencesOf(component, key): SourceLocation[] }`.

### 2.4 유즈케이스·프레젠테이션
| 구성요소 | 내용 |
|---|---|
| `FindStringReferences` (app) | `run(component, key): SourceLocation[]` — 포트 위임 |
| `ListResolvedStringCalls` (app) | `run(text): RangeItem[]` — `stringCalls` 중 `getString` 해석되는 것의 키 범위 (`RangeItem { line; column0; length }` DTO 추가) |
| `LangReferenceProvider` (presentation) | `**/lang/*/*.php` 한정 등록. 커서 줄 `\$string\[\s*'([^']+)'\]` + 커서가 키 범위 안 → `componentOfLangFile` 역산 → 미빌드면 `withProgress`로 lazy 빌드 → 위치 목록 |
| `registerStringHighlight` (presentation) | `createTextEditorDecorationType({ color: ThemeColor('textLink.foreground') })`. 초기 visible 에디터 + 활성 에디터 변경 즉시, 문서 변경은 **기존 KeyedDebouncer(300ms) 재사용**, 설정 토글 즉시. php/file 가드 선행 |
| `extension.ts` | UsageIndex 생성(hasCanonical=StringIndexStore 주입), 프로바이더·하이라이트 등록, `onDidSaveTextDocument`로 빌드 후 증분 갱신 |
| `package.json` | `csmscode.strings.highlightResolved` (boolean, 기본 true) 설정 기여 |

## 3. 테스트 전략
- **componentOfLangFile**: core(moodle.php/grades.php)·local·mod 예외·규칙 밖(null) — 순수 경로 유닛.
- **normalizeComponent 추출**: 기존 store 테스트 6건 그대로 녹색(등가성 핀) + 함수 직접 유닛.
- **StringUsageIndex**: mini-moodle 픽스처에 사용처 PHP(`local/ubattend/view.php`: canonical·레거시 bare·한 인자 core·변수 키 각 1건) 추가 → buildFromRoot 후 referencesOf(위치 정확성·레거시 canonical 귀속·변수 비색인), updateFileText 증분(항목 교체·제거), isBuilt.
- **ListResolvedStringCalls**: 실파서+실색인 E2E — 해석 키만 범위 반환(누락 키·미색인 component 제외).
- **회귀**: 기존 102건 녹색. 프로바이더/하이라이트 vscode 결선은 관례대로 tsc/lint + manual-verification.

## 4. 성공 기준
- lang 파일 Shift+F12 → 사용처 목록(첫 요청만 진행률, 이후 즉시), 저장 시 증분 반영 — 유즈케이스 레벨 테스트 재현.
- 해석 키 하이라이트 범위가 E2E로 재현, 설정 토글 동작.
- 기존 102건 무회귀 + 신규 ~15건, lint/compile/test-tsc 통과, 문서 갱신.
