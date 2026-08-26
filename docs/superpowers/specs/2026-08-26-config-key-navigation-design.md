# CSMS Code — 플러그인 설정 키(get_config) 탐색 설계

- **작성일**: 2026-08-26
- **상태**: 설계 확정 — 구현 계획 작성 단계
- **요청**: "get_config 도 레퍼런스를 할 수 없을까요?" — 이후 "그냥 알아서 해주세요"로 범위·순서 결정을 위임받음. 세 후보(A 플러그인 설정 리터럴 중심 / B + 코어 `$CFG->x` / C + 통째 접근) 중 **A**를 첫 사이클로 확정한 근거는 §1.
- **범위 확정**: `get_config('plugin', 'key')`·`set_config('key', v, 'plugin')`(컴포넌트 전파 포함)에서 settings.php 선언으로 **정의 이동·hover·해석 참조 하이라이팅**, 코드↔선언 **양방향 Shift+F12**, settings.php 선언 줄 **"사용 N건" CodeLens + hover 링크**, 키 **완성**. 문자열 표면(0.15.0·0.16.0)과 같은 세트.

---

## 1. 배경과 측정

Moodle 플러그인 설정은 `settings.php`에서 `admin_setting_*` 객체로 선언되고(`config_plugins` 테이블에 `plugin`·`name`으로 저장), 코드에서 `get_config($plugin, $name)`으로 읽고 `set_config($name, $value, $plugin)`으로 쓴다. 지금은 `get_config('local_ubion', 'haksa_auth')`에서 선언으로 갈 수도, 어디서 읽고 쓰는지 볼 수도 없다.

실측(hlulxp 커스텀 코드 — `local`·`blocks/ub*`·`mod/ub*`·`theme`, PHP):

| 항목 | 값 |
|---|---|
| `get_config('p', 'k')` 리터럴 두 인자 | **427건**(고유 쌍 307) |
| `get_config(<동적>, 'k')` | 117건 — 그중 **`$this->pluginname` 103건**(0.14.0 전파로 해석), `$pluginname` 11 |
| `get_config('p', $var)` 키가 동적 | 9건(침묵) |
| `get_config('p')` 통째 받아 `->key` | 72건 |
| `get_config('core'\|'moodle', …)` | 0건 |
| `set_config('k', v, 'p')` 리터럴 플러그인 | 10건(전체 844) / 전체 `set_config` 45건 |
| `unset_config` | 1건 |
| `$CFG->x` 접근 | 1,816건(전체 **18,894건**) |

선언 쪽(모든 settings.php + `admin/settings/*.php` + `lib/adminlib.php`):

| 선언 형태 | 전체 | 커스텀 |
|---|---|---|
| `new admin_setting_*('plugin/key', …)` 리터럴 | 1,814 | 52 |
| `new admin_setting_*($name, …)` 변수 | 1,166 | **1,004** |
| `new admin_setting_*($pluginname . '/key', …)` 연결 | 14 | 12 |
| `parent::__construct('key', …)` (코어 특수 설정 서브클래스, `lib/adminlib.php`) | (코어) | — |
| `config-dist.php` `$CFG->x =` | 188 | — |

커스텀 코드의 선언은 거의 전부 다음 관용구다(`local/csmsmedia/settings.php` 등):

```php
$pluginname = 'local_csmsmedia';
$name = $pluginname . '/organization_code';
$title = get_string('organization_code', $pluginname);
$setting = new admin_setting_configtext($name, $title, $description, $default);
```

파일 안에서 `$pluginname = '…'`와 `$name = $pluginname . '/…'`(또는 `$name = 'p/k'`)를 **등장 순서대로** 따라가면 풀린다 — 같은 변수에 반복 대입하는 형태라 "가장 가까운 선행 대입"이면 충분하고, 표현식 종류가 리터럴·연결·보간 셋뿐이어서 정규식 순차 스캔으로 된다(tree-sitter 불필요).

**해석률**: 위 규칙 + 코어 무슬래시 선언→`core` + `parent::__construct` + 복수형 클래스명(`admin_settings_num_course_sections`)을 포함하면 커스텀 `get_config('p','k')` 427건 중 **383건(89.7%)이 선언으로 해석**된다. 나머지 44건: `set_config`로만 만들어지는 런타임 키 8건(1.9% — `local_ubion/jwtSecretKey`·`tool_task/lastcronstart`), 어디에도 없는 키 36건(8.4% — `local_ubion` 10·`local_csmsmedia` 7·`theme_coursemos` 4…, 상당수가 죽은 키로 보임). 첫 측정에서 16%가 나온 것은 `$name` 관용구를 따라가지 않은 탓이었다.

### A를 고른 이유
- **B(코어 키)**: `get_config('core', …)`가 커스텀 코드에 0건이고, 참조 목록을 채우려면 `$CFG->x` 18,894건을 사용처 색인에 넣어야 해 색인이 크게 무거워진다. 지금 얻는 것이 없다.
- **C(통째 접근)**: `$c = get_config('local_x'); $c->key`(72건)는 변수→호출 추적(레코드 추론과 같은 기계)이 필요해 별도 사이클 크기다.

### 플러그인 이름은 **그대로**(정규화 없음)
lang 컴포넌트와 달리 설정의 `plugin`은 저장 키 그 자체다. `admin_setting_configtext('ubboard/key')`는 `config_plugins.plugin = 'ubboard'`에 저장되고 `get_config('ubboard', 'key')`가 읽는다. `get_config('mod_ubboard', 'key')`는 **다른 행**이다. 따라서 선언과 호출은 문자열을 그대로 비교한다. 예외는 Moodle의 규칙대로 `''`·`'moodle'`·`'core'`(그리고 슬래시 없는 선언) → `core` 하나뿐이며, 이 사이클에서 core는 색인만 하고 기능은 붙이지 않는다.

### grammar 확인
`get_config('p','k')`는 기존 `Q_STRING_CALL`과 같은 꼴(함수명 필터만 다름)이다. `set_config('k', <식>, 'p')`는 세 번째 인자를 문자열로 앵커해야 한다 — `(arguments . (argument (string (string_content) @key)) . (argument) . (argument (string (string_content) @plugin)))`. 동적 첫 인자는 기존 `Q_STRING_CALL_VAR/PROP/CONST`와 같은 세 형태이고 해석은 `resolveComponentRef`를 그대로 쓴다(인자 타입을 `{ comp, index, scope }` 구조형으로 넓힌다).

## 2. 목표

1. `get_config('p', 'k')`·`set_config('k', v, 'p')`의 **키 리터럴**에서 F12 → 그 설정을 선언한 `settings.php`의 `new admin_setting_*(…)` 줄(첫 인자 위치). hover → `**p / k**`, 설정 클래스(`admin_setting_configtext`), 선언 파일 상대 경로. 컴포넌트가 `$this->pluginname`·`$var`·`Class::CONST`이면 0.14.0 전파로 해석.
2. 해석되는 키를 링크 색상으로 하이라이팅(`csmscode.config.highlightResolved`, 기본 true).
3. 코드 쪽 Shift+F12 → 같은 (plugin, key)의 모든 `get_config`·`set_config` 호출처(+선언 포함 시 선언 위치). settings.php 선언 줄에서 Shift+F12 → 호출처.
4. settings.php 선언 줄 위 **"사용 N건"** CodeLens(`csmscode.config.codeLens`, 기본 true)와 코드 쪽 hover 아래 **"사용 N건 보기"** 링크 — 0.15.0의 문자열과 같은 버튼·라벨·명령 구조.
5. `get_config('local_x', '|')`에서 그 플러그인의 선언된 키 완성.
6. settings.php 저장 시 선언 색인을 그 파일만 증분 갱신(현재 전역 색인은 세션 중 갱신되지 않음 — 이 사이클에서 설정 키에 한해 해소).

### 비목표
- 코어 키(`get_config('core', …)`·`set_config('k', v)`·`$CFG->x`)의 참조(B). `$CFG->` 완성·hover·정의는 기존대로.
- `get_config('p')` 통째 접근·`->key` 추적(C). `unset_config`(1건).
- **누락 키 진단** — 해석 실패 8.4%에 런타임 전용 키(`set_config`로만 생성)가 섞여 있어 오탐이 필연이다. "선언됐거나 어디선가 `set_config`된 키"를 존재로 보는 규칙은 다음에 검토.
- hover에서 설정 제목(`$title = get_string(…)`)·기본값 표시 — 관용구가 변수를 거쳐 한 단계 더 추적해야 한다.
- 사용처 색인에서 값 인자에 괄호가 든 `set_config('k', get_config(…), 'p')` — 정규식으로 안전하게 자를 수 없어 침묵(45건 중 극소수).

## 3. 아키텍처

문자열 표면의 구조를 그대로 옮긴다: **선언 색인**(ConfigKeyIndex 확장) + **팩트**(tree-sitter) + **사용처 색인**(PhpUsageIndex에 종류 추가) + 유스케이스 + 얇은 프로바이더. 0.15.0의 참조 프로바이더·CodeLens·hover 링크는 문자열 전용으로 만들었으므로 이번에 **대상 타입에 일반화**해 두 표면이 공유한다.

### 3.1 도메인 (`src/domain/`)

```ts
// code-analysis/facts.ts
/** get_config('plugin','key') / set_config('key', v, 'plugin') — 플러그인이 리터럴 */
export interface ConfigCall { plugin: string; key: string; keyLine; keyColumn; keyIndex; index; kind: 'get' | 'set'; }
/** 플러그인 인자가 리터럴이 아닌 호출 — 문자열의 DynamicStringCall과 같은 세 형태, 같은 전파 */
export interface DynamicConfigCall { key: string; comp: ComponentRef; keyLine; keyColumn; keyIndex; index; scope: Scope; kind: 'get' | 'set'; }
DocumentFacts += configCalls: ConfigCall[]; dynamicConfigCalls: DynamicConfigCall[];

// moodle-model/ports/config-key-repository.ts
export interface ConfigDeclaration { plugin: string; key: string; settingClass: string; location: SourceLocation; }
export interface ConfigKeyRepository {
  keys(): ConfigKey[]; find(name: string): ConfigKey | undefined;           // 기존 — $CFG-> 용 납작한 이름
  declaration(plugin: string, key: string): ConfigDeclaration | undefined;  // 그대로 비교(core 별칭만 접음)
  declarationsIn(file: string): ConfigDeclaration[];                        // settings.php 쪽 Shift+F12·CodeLens
  keysOfPlugin(plugin: string): ConfigDeclaration[];                        // 완성
}
// moodle-model/ports/config-usage-repository.ts
export interface ConfigUsageRepository { configRefsOf(plugin: string, key: string): SourceLocation[]; }

// moodle-model/services/config-plugin.ts
/** ''·moodle·core → core, 나머지는 그대로 — 설정의 plugin은 저장 키 자체라 정규화하지 않는다 */
export function configPlugin(raw: string): string;
```

`resolveComponentRef(facts, call)`의 `call` 타입을 `ComponentRefSite = { comp: ComponentRef; index: number; scope: Scope }`로 넓힌다(`DynamicStringCall`·`DynamicConfigCall` 둘 다 만족).

### 3.2 settings.php 선언 파서 (`src/infrastructure/config/settings-declaration-parser.ts`, 순수 함수)

`parseSettingDeclarations(file, text): ConfigDeclaration[]` — 텍스트를 한 번 훑으며 다음을 등장 순서대로 처리한다.

| 만나는 것 | 처리 |
|---|---|
| `$v = 'lit';` / `$v = "lit";` | `vars[v] = lit` |
| `$v = $u . '/k';` / `$v = "$u/k";` / `$v = "{$u}/k";` | `vars[u]`가 있으면 `vars[v] = vars[u] + '/k'`, 없으면 `v` 삭제(모르는 값) |
| `new admin_setting(s)?_<class>(` 첫 인자 `'p/k'`·`"p/k"` | 선언 |
| … 첫 인자 `$v` | `vars[v]`가 `p/k` 꼴이면 선언, 아니면 침묵 |
| … 첫 인자 `$u . '/k'` / `"$u/k"` | `vars[u]`가 있으면 선언 |
| `parent::__construct(` 첫 인자 리터럴 | 선언(코어 특수 설정 — `lib/adminlib.php`) |

- 슬래시가 없는 이름은 `plugin = 'core'`, 있으면 첫 슬래시 기준으로 `plugin/key`(키에 슬래시가 더 있으면 그대로 키에 포함).
- `admin_setting_heading`은 값이 없는 제목이라 **제외**(`settingClass === 'heading'`). `admin_settingpage`·`admin_externalpage`는 패턴에 걸리지 않는다(`admin_setting_` 접두가 아님).
- 위치는 선언(`new …`) 줄과 첫 인자의 컬럼. 줄 번호는 매치마다 앞을 되짚지 않고 누적한다(기존 `collect`와 같은 방식).
- 대입은 `;`로 끝나는 한 문장만 본다(여러 줄 연결은 침묵). 같은 파일에서 같은 `(plugin, key)`가 두 번 선언되면 먼저 것을 유지한다.

### 3.3 ConfigKeyIndex 확장 (`src/infrastructure/config/config-key-index.ts`)

- 자료구조: `byName`(기존 납작한 맵, `$CFG->` 용) + `byPluginKey: Map<'plugin/key', ConfigDeclaration>` + `byFile: Map<file, ConfigDeclaration[]>` + `byPlugin: Map<plugin, ConfigDeclaration[]>`. 세 맵은 **조립 함수 하나**(`addDeclarations(file, decls)`/`removeFile(file)`)로만 바뀐다 — 다른 색인과 같은 규칙.
- 스캔 대상: `config-dist.php`(기존, `$CFG->x =` → core), `admin/settings/*.php`(기존), **`lib/adminlib.php`**(추가 — `parent::__construct`), 각 플러그인 `settings.php`(기존). 파일 열거는 기존 `settingsFiles()`.
- `config-dist.php`의 `$CFG->x =`는 `byName`에만 들어간다(플러그인 선언이 아님).
- **증분**: `updateFile(file)`(다시 읽어 그 파일 항목 교체)·`removeFile(file)`. 워처 `**/settings.php`·`**/admin/settings/*.php`. `byName`은 "먼저 찾은 선언 유지" 규칙 때문에 파일 단위 제거가 깔끔하지 않으므로 — 증분에서는 `byName`을 **그 파일의 항목만 지우고 다시 넣는다**(다른 파일이 같은 이름을 먼저 선언했으면 그쪽이 남아 있고, 없었으면 새로 들어간다). `$CFG->` 완성의 정확도에는 영향이 없다.
- **빌드 시점**: 활성화에 넣지 않는다(설정 키 수집 최대 정지 17~18ms — 전역 인텔리전스 설계의 결정 유지). 첫 요청(F12·hover·Shift+F12·완성·렌즈·**하이라이트가 설정 호출을 본 문서**)에서 lazy로 만들고, 전역 핸들(`globalsHandle`)과 **빌드 Promise를 공유**한다: `configBuild ??= configKeys.buildFromRootAsync(root)`. 전역 핸들은 클래스 멤버 색인 + 이 Promise를 기다린다. 하이라이트는 색인이 없으면 빌드를 시작만 하고 빈 결과를 돌려준 뒤, 빌드가 끝나면 `highlight.refreshAll()`로 다시 그린다.

### 3.4 팩트 (`tree-sitter-php-syntax.ts`)

```
Q_CONFIG_GET:  (function_call_expression function: (name) @fn arguments: (arguments
                 . (argument (string (string_content) @plugin)) . (argument (string (string_content) @key))))   ; fn = get_config
Q_CONFIG_SET:  (function_call_expression function: (name) @fn arguments: (arguments
                 . (argument (string (string_content) @key)) . (argument) . (argument (string (string_content) @plugin))))  ; fn = set_config
동적 플러그인: get_config의 첫 인자 / set_config의 세 번째 인자가 (variable_name) | (member_access_expression $this->x) | (class_constant_access_expression)
```
`Q_STRING_CALL`이 `get_config('p','k')`에도 매칭되므로(첫 인자 문자열·둘째 문자열) 함수명 필터가 갈라 준다 — 문자열 형태 표에 `get_config`는 없으니 stringCalls에는 들어가지 않는다. 함수 이름은 도메인 표 `config-functions.ts`(`get_config`→플러그인 위치 0·키 위치 1, `set_config`→키 0·플러그인 2)에 둔다.

### 3.5 사용처 색인 (`php-usage-index.ts`)

한 번의 스캔에서 함께 수집한다(다른 종류와 같은 이유). 정규식:
```
GET: \bget_config\(\s*['"](\w+)['"]\s*,\s*['"](\w+)['"]\s*\)
SET: \bset_config\(\s*['"](\w+)['"]\s*,\s*[^;()]*?,\s*['"](\w+)['"]\s*\)      ; 값에 괄호가 있으면 침묵
```
키 `configPlugin(p) + '/' + k` → `SourceLocation[]`(키 리터럴 위치), 파일별 역인덱스로 증분 제거. `configRefsOf(plugin, key)`. 동적 플러그인 호출은 문자열과 같은 이유로 목록에 없다(백로그 19번과 같은 제한 — 문서화).

### 3.6 애플리케이션 (`src/application/`)

| 유스케이스 | 입력 → 출력 |
|---|---|
| `config-call-lookup.ts` `allConfigCalls(facts)` / `findConfigCallAt(facts, at)` | 리터럴 + 전파로 해석된 동적 호출; 커서가 키 리터럴 안인 호출 |
| `LocateConfigTarget(syntax)` `.php(text, at)` / `.settings(file, line)` | `{ plugin, key } \| null` — settings 쪽은 `declarationsIn(file)`에서 그 줄 |
| `ResolveConfigDefinition(syntax, configs)` | 선언 위치 |
| `DescribeConfigKey(syntax, configs)` | `HoverResult` + `target`(링크용) |
| `FindConfigReferences(usages, configs)` `.run(plugin, key, includeDeclaration)` | 사용처(+선언) |
| `ListResolvedConfigRefs(syntax, configs)` | 해석되는 키 범위(하이라이트) |
| `CompleteConfigKeys(configs)` `.run(plugin)` | 그 플러그인의 키 목록(설정 클래스를 detail로) |

`HoverResult.target`은 `StringTarget`에서 `{ kind: 'string' \| 'config'; component: string; key: string }`으로 넓힌다(config는 component 자리에 plugin). 링크 명령이 kind로 갈린다.

### 3.7 프레젠테이션 — 문자열 전용을 대상 타입에 일반화

| 0.15.0 | 이번 |
|---|---|
| `StringReferenceProvider(locate, FindStringReferences, usage)` | `TargetReferenceProvider<T>(locate, find: (t, includeDeclaration) => SourceLocation[], usage)` — 문자열·설정 두 인스턴스 |
| `LangCodeLensProvider(entriesOf, componentOf, refs, enabled)` | `UsageCodeLensProvider(targetsOf: (doc) => UsageLensTarget[], enabled)` — `UsageLensTarget { line; count(): number \| null; command; args }`. lang 파일용·settings.php용 `targetsOf`는 컴포지션 루트가 조립 |
| `csmscode.showStringReferences` | 유지 + `csmscode.showConfigReferences`(인자 `{ uri, line, character, plugin, key }`). 두 명령이 같은 `showReferencesPeek(uri, pos, locations)` 헬퍼를 쓴다 |
| `stringHover(doc, pos, r, refs)` | `hoverWithReferences(doc, pos, r, counters)` — `r.target.kind`로 명령·카운터를 고른다 |
| `string-references-link.ts` | `lensTitle`·링크 마크다운 생성기를 명령 이름을 인자로 받게 일반화 |

새 프로바이더: `ConfigDefinitionProvider`, `ConfigHoverProvider`, `ConfigKeyCompletionProvider`(트리거: `get_config('p', '` — 플러그인 리터럴이 앞에 있을 때만), settings.php용 참조 프로바이더 인스턴스(`{ language: 'php', scheme: 'file', pattern: '**/settings.php' }` + `**/admin/settings/*.php`), 하이라이트 소스 `{ setting: 'config.highlightResolved', languages: ['php'] }`.

설정: `csmscode.config.highlightResolved`(기본 true), `csmscode.config.codeLens`(기본 true).

### 3.8 결선 (`extension.ts`)

- `configHandle = { built: () => configReady, build: () => configBuild ??= configKeys.buildFromRootAsync(root).then(() => { configReady = true; highlight.refreshAll(); settingsLens.refresh(); }) }`. `globalsHandle.build`는 클래스 멤버 빌드 + `configHandle.build()`.
- 사용처 색인 핸들(`usageHandle`)은 그대로 공유(참조·명령·렌즈 개수).
- 워처: `**/settings.php`·`**/admin/settings/*.php` 변경/생성/삭제 → `applyIncremental(() => configKeys.updateFile/removeFile)` → `settingsLens.refresh()` + 하이라이트 갱신. 색인이 아직 없으면(lazy 전) 아무것도 하지 않는다 — 다음 빌드가 담는다.

## 4. 데이터 흐름 예

`local/csmsmedia/lib.php`의 `get_config('local_csmsmedia', 'organization_code')` 키 위에서:
- **F12**: 팩트 `ConfigCall{plugin:'local_csmsmedia', key:'organization_code'}` → `configs.declaration(…)` → `local/csmsmedia/settings.php`의 `new admin_setting_configtext($name, …)` 줄(파서가 `$name = $pluginname . '/organization_code'`를 따라가 얻은 선언).
- **hover**: `**local_csmsmedia / organization_code**` · `admin_setting_configtext` · `local/csmsmedia/settings.php:28` · 아래에 `사용 9건 보기`.
- **Shift+F12**: 사용처 색인 `configRefsOf` 9건 + 선언 1건.
- settings.php 그 줄 위 CodeLens `사용 9건` → 클릭 → 그 자리에서 peek.

## 5. 침묵·오류 규칙

- 선언을 못 찾는 키: 이동·hover·하이라이트·렌즈 없음. 진단 없음(비목표).
- 플러그인이 동적이고 전파로 해석되지 않는 호출: 팩트에 없음 → 모든 기능 침묵. 전파로 해석돼도 **사용처 목록에는 없음**(정규식 색인) — README 알려진 제한에 기록.
- settings.php 파서가 모르는 관용구(함수 반환값·배열 등): 그 선언만 없음.
- 색인 빌드 실패는 기존 전역 색인과 같이 로그만 남기고 기능은 침묵.

## 6. 테스트 계획

- **파서(순수)**: 리터럴·`$name` 변수(재대입 순서)·`$pluginname . '/k'`·`"$p/k"`·`parent::__construct`·복수형 클래스·heading 제외·슬래시 없는 코어·모르는 변수 침묵·위치(줄·컬럼).
- **ConfigKeyIndex**: 픽스처 `local/ubattend/settings.php`에 `$name` 관용구 선언을 추가하고 `lib/adminlib.php` 픽스처(`parent::__construct('gradebookroles'`) 추가. `declaration`·`declarationsIn`·`keysOfPlugin`·`find`(기존 납작 맵 무회귀)·`updateFile/removeFile` 수렴.
- **tree-sitter**: `get_config('p','k')`·`set_config('k', v, 'p')`·`set_config('k', ['a'=>1], 'p')`(값이 배열)·동적 `$this->pluginname`·`get_config('p')`(한 인자 — 팩트 없음)·`get_config('p', $k)`(침묵).
- **사용처 색인**: get/set 위치, 값에 괄호가 든 set_config 침묵, 증분 교체.
- **유스케이스**: 정의·hover(target)·참조(+선언)·하이라이트·완성 — mini-moodle 픽스처 위 실물 조합.
- **프레젠테이션 순수부**: 일반화된 링크 생성기(명령 인자화)·렌즈 대상 조립 함수.
- 기존 436건 무회귀.

## 7. 문서·버전

- README 기능 항목·설정 표·알려진 제한(동적 플러그인 호출은 사용처 목록에 없음), CHANGELOG **0.17.0**(MINOR — 새 기능 표면), 백로그(완료 표시·B/C·진단·제목 hover 후속), 수동 검증 항목 추가.
