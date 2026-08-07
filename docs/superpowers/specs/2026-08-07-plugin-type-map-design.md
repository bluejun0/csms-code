# CSMS Code — 플러그인 타입 맵을 Moodle 선언에서 읽기

- **작성일**: 2026-08-07
- **상태**: 설계 확정 — 구현 계획 작성 단계
- **대상**: `docs/PHASE2-BACKLOG.md` 19번(및 6번 잔여, AMD 미해석 요인 ①)

---

## 1. 배경

지금 플러그인 타입 → 디렉터리 매핑은 손으로 관리하는 상수 `PLUGIN_DIRS` 30개다. 이 맵이 네 색인(install.xml·lang·템플릿·AMD)의 열거와 경로 역산을 모두 좌우하므로, 여기 없는 타입은 **어떤 기능에서도 보이지 않는다**.

Moodle은 이 매핑을 스스로 선언한다.

| 출처 | 내용 | 4.5.8 | 3.9.8 | 3.5.9 | 2.9.4 |
|---|---|---|---|---|---|
| `lib/components.json` → `plugintypes` | 최상위 플러그인 타입 | 45 | 39 | 없음 | 없음 |
| `<plugin>/db/subplugins.json` → `plugintypes` | 서브플러그인 타입(루트 상대 경로) | 13파일 | 13파일 | 1파일 | 0파일 |
| `<plugin>/db/subplugins.php` → `$subplugins = array(…)` | 같은 내용의 구형식(루트 상대 경로) | 1파일 | 1파일 | 12파일 | 11파일 |

`components.json`에는 **서브플러그인 타입이 없다** — `assignsubmission`·`quizaccess`·`atto`·`tiny`는 각 플러그인의 `subplugins.*`에만 있다. 그래서 두 출처를 모두 읽어야 한다.

### 실측 효과 (정적 30개 → 합집합)

| 저장소 | 타입 | 플러그인 | install.xml | lang 파일 | 템플릿 | AMD 모듈 |
|---|---|---|---|---|---|---|
| hlulxp 4.5.8 | 30 → **65** | +146 | +27 | +148 | +110 | +167 |
| csms39 3.9.8 | 30 → **58** | +106 | +25 | +105 | +15 | +19 |
| dghuedu 3.5.9 | 30 → **45** | +56 | +18 | +59 | 0 | 0 |
| inulms 2.9.4 | 30 → **43** | +47 | +16 | +50 | 0 | 0 |

구버전(3.5·2.9)은 `components.json`이 없어도 `subplugins.php` 해석만으로 타입이 15·13개 늘고 플러그인 56·47개가 새로 색인된다. 이 두 형식을 모두 읽는 것이 중요하다.

## 2. 목표

1. 타입 맵을 Moodle 선언에서 읽어 백로그 6번 잔여(qbank·tiny·quizaccess·assignsubmission 등)와 AMD 미해석 원인 ①을 함께 해소한다.
2. 선언이 없는 구버전에서도 지금과 같거나 더 나은 커버리지를 유지한다(정적 맵은 폴백으로 남긴다).
3. 맵 구성 비용이 워처 이벤트·F12 경로에 반복해서 실리지 않게 한다.

### 비목표
- 플러그인 타입별 특수 규칙(예: 테마 오버라이드) 변경. 열거·역산 규칙은 그대로 두고 **맵의 출처만** 바꾼다.
- `subplugins.php`의 PHP를 실제로 실행/파싱하는 것(정규식으로 리터럴 쌍만 읽는다).
- 새 타입을 위한 lang 파일명 규칙 변경(`mod`만 예외인 기존 규칙 유지).

## 3. 설계

### 3.1 새 모듈 `src/infrastructure/workspace/plugin-type-map.ts`

`moodle-root-resolver.ts`는 이미 열거·역산으로 충분히 크다. 맵 구성은 책임이 다르므로 파일을 분리한다.

```ts
export const STATIC_PLUGIN_DIRS: Record<string, string>;      // 기존 PLUGIN_DIRS가 여기로 이동
export function pluginTypeDirs(root: string): Map<string, string>;
export function pluginTypeDirsAsync(root: string): Promise<Map<string, string>>;
export function clearPluginTypeCache(root?: string): void;     // 인자 없으면 전체
```

**구성 순서(뒤가 이긴다)**: 정적 맵 → `components.json`의 `plugintypes` → 서브플러그인 선언. 같은 타입이 다른 디렉터리를 가리키면 더 권위 있는 쪽(뒤)이 이긴다. 존재하지 않는 디렉터리는 열거에서 자연히 걸러지므로 합집합이 커버리지를 잃지 않는다.

**서브플러그인 탐색**: 지금까지 알려진 타입 디렉터리 아래 각 플러그인에서 `db/subplugins.json`을 먼저 보고, 없으면 `db/subplugins.php`를 본다. 새 타입이 나오면 그 디렉터리에도 서브플러그인이 있을 수 있으므로 **새 타입이 더 안 나올 때까지 반복하되 3회로 제한**한다(실측 2회면 고정점).

`subplugins.php`는 실행하지 않고 `'타입' => '루트/상대/경로'` 리터럴 쌍만 정규식으로 읽는다. 리터럴이 없는 형태(`json_decode(file_get_contents(...))`로 JSON을 읽는 4.5의 `tool_mfa`)는 아무것도 매칭되지 않고, 같은 디렉터리의 JSON이 이미 읽혀 문제가 없다.

**메모이즈**: 루트별로 캐시한다. 실측 구성 비용이 72ms(4.5 웜)~419ms(2.9 콜드)라 경로 역산마다 다시 만들 수 없다 — 역산은 워처 이벤트와 F12마다 호출된다. 비동기 판은 `INDEX_YIELD_EVERY`마다 양보한다. 두 판 모두 **같은 캐시**를 채우고 읽는다.

### 3.2 소비자 변경

`PLUGIN_DIRS`를 직접 순회하던 모든 곳이 `pluginTypeDirs(root)`/`pluginTypeDirsAsync(root)`를 쓴다.

| 함수 | 변경 |
|---|---|
| `listInstallXmlFiles(Async)` · `listLangFiles(Async)` · `listTemplateFiles(Async)` · `amdRoots(Async)` | 맵을 인자 없이 루트로 가져온다 |
| `pluginTypeOfRel(rel)` → **`pluginTypeOfRel(root, rel)`** | 맵이 루트에 의존하므로 시그니처가 바뀐다. 최장 매치 규칙은 그대로 |
| `componentOfInstallXmlFile`·`langFileMetaOf`·`componentOfTemplateFile`·`componentOfAmdFile`·`coreSubsystemDirs` | 이미 `root`를 받으므로 호출만 바꾼다 |

`PLUGIN_DIRS`라는 이름의 export는 제거하고 `STATIC_PLUGIN_DIRS`로 대체한다 — 이름이 남아 있으면 새 코드가 다시 정적 맵을 직접 쓰게 된다.

### 3.3 동작 변화 — 역산의 정밀화

타입이 늘면 `pluginTypeOfRel`의 최장 매치가 더 구체적인 답을 낸다. 예: `mod/quiz/accessrule/seb/lang/en/quizaccess_seb.php`는 지금 `mod_quiz` + 나머지 `accessrule/seb/lang/...`로 잡혀 lang 규칙에 안 맞아 `null`(침묵)이지만, `quizaccess`가 맵에 있으면 `quizaccess_seb`로 정확히 해석된다. **침묵이 정답으로 바뀌는 방향이라 회귀가 아니다.**

### 3.4 캐시 무효화

- 활성화 시 전체 빌드(`gatedRebuild`)가 시작될 때 해당 루트 캐시를 비운다.
- `lib/components.json`과 `**/db/subplugins.json`·`**/db/subplugins.php` 변경은 타입 맵 자체를 바꾸므로 **파일 단위 증분이 불가능하다** — 이 파일들의 워처는 캐시를 비우고 `gatedRebuild`를 다시 돌린다.

## 4. 테스트 전략

- **맵 구성**: 정적만 있는 루트(선언 파일 없음) → 정적과 동일. `components.json`이 있으면 그 타입이 더해짐. `subplugins.json`·`subplugins.php` 각각에서 타입이 더해짐. `.php`의 리터럴 없는 형태는 아무것도 더하지 않음. 파손 JSON은 무시. 같은 타입이 겹치면 뒤(권위 있는 쪽)가 이김.
- **반복 탐색**: 서브플러그인의 서브플러그인이 한 번 더 발견되는 픽스처로 고정점 도달 확인.
- **메모이즈**: 같은 루트 2회 호출이 파일을 다시 읽지 않음(읽기 횟수를 세는 대신, `clearPluginTypeCache` 전후로 새 파일이 반영되는지로 관찰).
- **동기 ≡ 비동기**: 같은 루트에서 두 판의 결과가 같음.
- **소비자 회귀**: 네 열거의 기존 단언 유지 + 새 타입(픽스처의 서브플러그인)이 install.xml·lang·템플릿·AMD 각각에서 잡히는지.
- **역산 정밀화**: 서브플러그인 경로가 상위 타입이 아니라 서브플러그인 타입으로 역산되는지.
- **회귀**: 기존 261건 녹색.

## 5. 성공 기준

- hlulxp에서 타입 65개·플러그인 541개가 색인되고, `quizaccess_seb`·`qbank_*`·`tiny_*`의 lang·템플릿·AMD가 해석된다.
- 구버전(3.5·2.9)에서도 `subplugins.php`만으로 타입이 늘어난다.
- 활성화 경로의 최대 이벤트 루프 정지가 기존 수준(한 자릿수 ms)을 유지한다 — 실측으로 확인.
- 기존 261건 무회귀, lint/compile 통과, 버전 0.7.0 + CHANGELOG.
