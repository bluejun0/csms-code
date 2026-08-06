# CSMS Code — AMD 모듈 참조 이동 설계

- **작성일**: 2026-08-06
- **상태**: 설계 확정 — 구현 계획 작성 단계
- **요청**: "`$PAGE->requires->js_call_amd('local_ubion/user', 'index');` 에서 템플릿 참조하는게 제공하라"
- **범위 확정**: 정의 이동 + 하이라이트 + 사용처 참조(Shift+F12) — 템플릿 표면과 같은 3세트

---

## 1. 배경과 측정

`js_call_amd('local_ubion/user', 'index')`의 첫 인자는 AMD 모듈 참조이고 실제 파일은 `local/ubion/amd/src/user.js`다. 지금은 이 리터럴에서 파일로 갈 방법이 없다.

| 항목 | 값 |
|---|---|
| `js_call_amd` 호출 | **354건** (hlulxp `local`·`theme/coursemos`·`blocks`·`mod`의 PHP 6,785개) |
| 실제 `amd/src` 파일로 해석됨 | **326건 (92.1%)** |
| 중첩 경로(`local_x/foo/bar`) | 155건 |
| 두 번째 인자(함수명)가 있는 호출 | 347건 |
| 홑따옴표 / 겹따옴표 | 348 / 2 |

해석 실패 28건의 정체는 두 가지다.
- **코어 서브시스템 매핑 부재**: `core_form/submit`은 `lib/form/amd/src/submit.js`, `core_question/question_engine`은 `question/amd/src/question_engine.js`에 있다. 컴포넌트명에서 디렉터리를 유도할 수 없다.
- **실제로 없는 모듈**: `local_ubion/asiteHaksa`는 `amd/src`에도 `amd/build`에도 없다(죽은 참조). 이런 것은 침묵이 정답이다.

### 코어 서브시스템 해석 근거

`lib/components.json`에 권위 있는 매핑이 있다(4.5: subsystems 80 + plugintypes 45, 3.9: subsystems 71). 값이 `null`인 항목(디렉터리 없는 서브시스템)은 건너뛴다. 이 파일은 **3.5·2.9에는 없다** — 없으면 코어 서브시스템 모듈만 조용히 침묵하고 플러그인 모듈은 그대로 동작한다.

### grammar 확인

기존 `Q_TEMPLATE_CALL`(`(member_call_expression name: (name) @method arguments: (arguments . (argument (string (string_content) @ref))))`)이 수신자를 제약하지 않으므로 `$PAGE->requires->js_call_amd(…)`와 `$this->page->requires->js_call_amd(…)` 모두 매칭된다. 중첩 경로도 그대로 잡힌다. 동적 인자와 겹따옴표는 매칭되지 않는다(문자열·템플릿 표면과 같은 성질 — 겹따옴표는 실측 2건).

## 2. 목표

1. `js_call_amd`의 첫 인자에서 F12 → `amd/src`의 해당 `.js` 파일로 이동. 중첩 경로와 코어 서브시스템 포함.
2. 해석되는 모듈 참조를 링크 색상으로 하이라이팅(설정으로 끌 수 있음).
3. `amd/src`의 `.js` 파일에서 Shift+F12 → 그 모듈을 부르는 `js_call_amd` 호출처 목록.

### 비목표
- **진단**: 죽은 참조(`local_ubion/asiteHaksa`)를 실제로 식별할 수 있지만, 이번 범위 밖이다. `amd/build`만 있고 `src`가 없는 배포 형태를 오탐할 위험을 따로 확인해야 한다.
- JS 파일 안의 `import 'local_x/y'`·`require(['local_x/y'])` 이동(실측 1,161건·97% 해석 가능 — 별도 사이클), 모듈 이름 자동완성, 두 번째 인자(함수명)의 함수 정의로 이동, `js_amd_inline`.
- 겹따옴표 리터럴(실측 2건).

## 3. 설계

기존 템플릿 표면과 **같은 구조를 그대로 따른다**. 새로운 패턴을 만들지 않는다.

### 3.1 열거와 경로 역산 (`moodle-root-resolver.ts`)

```ts
export interface AmdFileRef { file: string; component: string; name: string; }
export function listAmdFiles(root: string): AmdFileRef[];
export function listAmdFilesAsync(root: string): Promise<AmdFileRef[]>;
export function componentOfAmdFile(root: string, file: string): { component: string; name: string } | null;
export function coreSubsystemDirs(root: string): Map<string, string>;   // 서브시스템명 → 루트 기준 디렉터리
```
- 대상: 각 플러그인 `<PLUGIN_DIRS[type]>/<name>/amd/src/**/*.js` → component `<type>_<name>`, name은 `amd/src` 이하 경로에서 `.js`를 뗀 것(구분자는 `/`).
- 코어: `lib/amd/src/**/*.js` → component `core`.
- 코어 서브시스템: `coreSubsystemDirs()`의 각 디렉터리 아래 `amd/src/**/*.js` → component `core_<서브시스템>`.
- `amd/build`는 열거하지 않는다(미니파이 사본).
- 템플릿 열거와 같은 realpath `seen` 순환 가드를 쓴다.
- `coreSubsystemDirs`는 `lib/components.json`을 읽어 `subsystems`의 non-null 항목만 담는다. 파일이 없거나 JSON이 깨지면 빈 Map(침묵).

### 3.2 색인 (`src/infrastructure/amd/amd-index.ts`)

`TemplateIndex`와 같은 형태 — 동기 빌드·비동기 빌드·파일 단위 증분이 **조립 함수 하나**(`addRef`)를 통과하고, 이미 등록된 파일의 `updateFile`은 배열 순서를 보존한다.

```ts
export class AmdIndex implements AmdRepository {
  buildFromRoot(root: string): void;
  buildFromRootAsync(root: string, onProgress?): Promise<void>;
  updateFile(file: string, component: string, name: string): void;
  removeFile(uri: string): void;
  locationsOf(component: string, name: string): SourceLocation[];
  has(component: string, name: string): boolean;
}
```
포트는 `src/domain/amd-model/ports/amd-repository.ts`. 참조 문자열 분해는 **`parseTemplateRef`를 재사용하지 않고** 같은 규칙의 `parseModuleRef`를 `domain/shared/`에 두고 양쪽이 함께 쓴다 — `component/name`(name에 하위 경로 허용) 규칙이 두 표면에서 동일하고, 한쪽 이름에 묶여 있으면 다른 표면에서 읽기 어렵다.

### 3.3 팩트 (`facts.ts`, `tree-sitter-php-syntax.ts`)

```ts
export interface AmdCall { ref: string; refLine: number; refColumn: number; refIndex: number; index: number; }
```
`DocumentFacts.amdCalls`로 추가한다. 추출은 **기존 `templateCall` 쿼리 매치를 재사용**하고 메서드명으로 갈라 담는다(`render_from_template` → templateCalls, `js_call_amd` → amdCalls). 쿼리를 새로 만들면 같은 노드를 두 번 훑는다.

### 3.4 사용처 색인 (`php-usage-index.ts`)

`js_call_amd` 리터럴을 PHP 추출기에 추가한다. 정규식 하나(`AMD_USAGE_RE`)와 `byAmdRef`/`amdByFile` 쌍을 기존 템플릿 쪽과 같은 모양으로 둔다. 줄·컬럼 계산은 기존과 같은 증분 방식이다. JS 추출기에는 넣지 않는다(JS의 `import`는 비목표).

포트 `src/domain/amd-model/ports/amd-usage-repository.ts`의 `amdRefsOf(component, name)`.

### 3.5 유즈케이스

| 파일 | 역할 |
|---|---|
| `application/resolve-amd-definition.ts` | `run(text, atIndex): DefinitionResult[]` — 커서가 ref 범위 안이고 색인에 있으면 위치 |
| `application/list-resolved-amd-calls.ts` | `run(text): RangeItem[]` — 해석되는 참조만 |
| `application/find-amd-references.ts` | `run(component, name): SourceLocation[]` — 포트 위임 |

### 3.6 프리젠테이션·결선

- `presentation/providers/amd-definition-provider.ts` (php), `amd-reference-provider.ts` (`**/amd/src/**/*.js` 패턴).
- 하이라이트 소스 `{ setting: 'amd.highlightResolved', languages: ['php'] }`, 설정 `csmscode.amd.highlightResolved`(기본 `true`).
- `extension.ts`: `buildAll`에 `amd.buildFromRootAsync(root)` 추가, `**/amd/src/**/*.js` 워처를 `applyIncremental`로 결선(역산 null이면 침묵), 참조 프로바이더는 기존 lazy 사용처 빌드 훅을 공유한다.

## 4. 테스트 전략

- **열거·역산**: 플러그인 중첩 경로(`amd/src/a/b.js` → name `a/b`), 코어(`lib/amd/src`), 코어 서브시스템(components.json 있음/없음), `amd/build` 제외, 역산 왕복(파일 → component/name → 위치), 규칙 밖 경로 null.
- **색인**: 동기 ≡ 비동기, 증분이 전체 재빌드와 수렴(이름·컴포넌트까지 비교), 이미 등록된 파일의 `updateFile`이 순서를 보존.
- **팩트**: `$PAGE->requires->js_call_amd` 추출, 중첩 경로, 동적 인자 비추출, `render_from_template`와 서로 섞이지 않음(양쪽 배열이 각자 자기 것만 담는지).
- **유즈케이스**: 색인에 있는 참조 → 위치, 없는 참조 → 빈 배열, 커서가 ref 밖 → 빈 배열, 하이라이트는 해석되는 것만.
- **사용처**: `js_call_amd` 추출 위치 정확성, 파일 단위 증분 후 참조 목록 갱신.
- **회귀**: 기존 232건 녹색.

## 5. 성공 기준

- `js_call_amd('local_ubion/user', 'index')`에서 F12 → `local/ubion/amd/src/user.js`.
- `core_form/submit`에서 F12 → `lib/form/amd/src/submit.js`(components.json 있는 버전).
- `local_ubion/asiteHaksa`처럼 없는 모듈은 이동·하이라이트 없음.
- `amd/src/user.js`에서 Shift+F12 → 그 모듈을 부르는 PHP 호출처 목록.
- lint/compile/test 통과, 버전 0.6.0 + CHANGELOG 항목.
