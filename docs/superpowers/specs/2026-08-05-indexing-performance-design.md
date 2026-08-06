# CSMS Code — 색인 성능 최적화 설계 (비동기 활성화 + 증분 워처)

- **작성일**: 2026-08-05
- **작성자**: Claude (jun0@bluesoft.co.kr — "최적화도 해주세요" 요청, 실측 후 범위를 Claude가 좁히고 승인받음)
- **상태**: 설계 확정 — 구현 계획 작성 단계
- **선행 문서**: `docs/PHASE2-BACKLOG.md` 5번·7번

---

## 1. 배경 — 측정이 범위를 정했다

추측 대신 hlulxp(PHP 21,723 / JS 4,721 / 템플릿 2,951)에서 실측했다.

| 경로 | 비용 | 빈도 | 판정 |
|---|---|---|---|
| **활성화 시 동기 색인 3종** | **콜드 ~1,730ms** (열거 741 + 읽기·파싱 ~990) / 웜 148ms | 워크스페이스 열 때마다 | **고친다** |
| **워처 전체 재색인** | lang 저장 **122ms** / install.xml 21ms / mustache 46ms | 해당 파일 저장마다 | **고친다** |
| 타이핑 후 진단+하이라이트 | p50 **2ms** / p90 11 / p95 21 / p99 48 / max 263 | 타이핑 멈출 때마다 | **안 고친다** |
| 사용처 스캔(lazy) | 27.5초, 최대 이벤트루프 정지 87ms | 첫 참조 요청 1회 | 안 고친다 |

### 안 고치는 이유 (명시)
- **tree-sitter 증분 파싱**: `local/` PHP 1,379개의 크기 p50 1.4KB(파싱 2ms), p90 15KB(11ms). 50ms를 넘는 것은 상위 1%뿐이고, 증분 파싱은 트리 수명·WASM 힙 관리를 새로 떠안는다. 측정값이 불필요를 말한다. (기존 LRU 캐시가 같은 텍스트에 대한 4개 소비자의 중복 파싱은 이미 제거한다 — 실측 캐시 히트 0.0ms.)
- **사용처 스캔**: 파일 전체를 읽어야 매치를 알 수 있어 사실상 I/O 하한이고, 이미 200파일마다 양보해 최대 정지가 87ms다.

## 2. 목표
1. 활성화 시 확장 호스트 블로킹 제거 — 열거·읽기 모두 비동기화하고 진행률을 상태바에 표시.
2. 워처가 파일 하나 변경에 전체 재색인하지 않도록 — 파일 단위 증분(실측 122ms → 한 자릿수 ms; install.xml·템플릿은 1ms 미만, lang은 removeFile의 전체 스캔 때문에 ~6ms).
3. 동기·비동기 두 경로가 **같은 결과**를 내도록 구조적으로 보장(조립 로직 공유 + 등가성 테스트).

### 비목표(YAGNI)
- 증분 파싱, 사용처 스캔 재설계(위 근거), 색인 디스크 캐시·워커 스레드, 진행률 취소.

---

## 3. 설계

### 3.1 열거 비동기화 (`moodle-root-resolver.ts`)
콜드 1,730ms 중 **741ms가 열거**(`existsSync`/`readdirSync` 루프)다. 기존 동기 함수는 그대로 두고(테스트·증분 경로가 사용) 비동기 형제를 추가한다:
```ts
export async function listInstallXmlFilesAsync(root: string): Promise<{ file: string; component: string }[]>
export async function listLangFilesAsync(root: string): Promise<LangFileRef[]>
export async function listTemplateFilesAsync(root: string): Promise<TemplateFileRef[]>
```
`fs.promises` 사용 + **N(=200) 항목마다 `setImmediate` 양보**(사용처 스캔과 동일 관례). 컴포넌트 판정 로직은 동기 버전과 **같은 함수**(`pluginTypeOfRel`·`componentOfTemplateFile`)를 호출하므로 규칙이 갈라질 수 없다.

### 3.2 조립 공유 — 동기·비동기 결과 동일성 보장
각 색인에서 "파일 내용 → 색인 구조" 조립을 **한 곳으로** 뽑고 두 경로가 그것만 호출한다. I/O 방식만 다르고 조립은 하나다.

| 색인 | 조립 단위 | 비고 |
|---|---|---|
| `IndexStore` | `parseInstallXml(text, file, component) → Table[]` (기존) | 이미 분리돼 있음 |
| `StringIndexStore` | `private mergeInto(map, file, component, locale, text)` (신설) | 기존 buildFromRoot 본문에서 추출 |
| `TemplateIndex` | `private addRef(map, file, component, name)` (신설) | 파일 내용을 읽지 않음 — 열거만 비동기화하면 끝 |

각 색인에 **동기·비동기 등가성 테스트**를 둔다: 픽스처에서 `buildFromRoot`와 `await buildFromRootAsync`가 같은 조회 결과를 내는지.

### 3.3 비동기 빌드 API
세 색인에 추가(기존 동기 `buildFromRoot`는 유지 — 테스트·폴백용):
```ts
buildFromRootAsync(root: string, onProgress?: (done: number, total: number) => void): Promise<void>
```
`onProgress`는 vscode 무관(테스트 가능). 완성된 맵을 만든 뒤 **마지막에 한 번** 교체하므로, 빌드 중 조회는 이전 상태(첫 빌드면 빈 상태)를 보고 부분 결과를 노출하지 않는다.

### 3.4 증분 갱신
경로에서 메타를 역산하는 함수를 추가하고(기존 역산과 같은 자리·같은 규칙):
```ts
export function componentOfInstallXmlFile(root: string, file: string): string | null   // <relDir>/<name>/db/install.xml
export function langFileMetaOf(root: string, file: string): { component: string; locale: string } | null
// 템플릿은 기존 componentOfTemplateFile 재사용
```
색인 3종에 파일 단위 API:
| 색인 | 추가 | 구현 메모 |
|---|---|---|
| `IndexStore` | **기존 `updateFile`/`removeFile` 결선**(현재 죽은 코드 — 백로그 7번) | `InMemoryTableRepository.upsert`/`removeByUri` 사용 |
| `StringIndexStore` | `updateFile(file, component, locale)`, `removeFile(uri)` | 해당 locale 엔트리만 교체/삭제, 두 locale 모두 사라진 키는 제거, 빈 컴포넌트 맵도 제거(정규화가 `has()`에 의존하므로 잔존 금지) |
| `TemplateIndex` | `updateFile(file)`, `removeFile(uri)` | `byRef` 배열에서 해당 uri만 제거 후 재추가, 빈 배열 키 삭제 |

### 3.5 결선 (`extension.ts`)
- **활성화**: 세 색인을 `buildFromRootAsync`로 순차 실행하고 `vscode.window.withProgress({ location: ProgressLocation.Window, title: 'CSMS Code: 색인 중…' })`로 감싼다. **Notification이 아니라 Window(상태바)** — 워크스페이스를 열 때마다 뜨는 알림은 소음이다. 프로바이더는 즉시 등록하고(빌드 전 조회는 빈 결과 = 침묵 원칙), 빌드 완료 후 열린 에디터의 진단·하이라이트를 한 번 갱신한다.
  - 갱신 훅: `registerDiagnostics`와 `registerResolvedHighlight`가 각각 `refreshAll(): void`를 반환하도록 하고(현재는 반환값 없음), 빌드 완료 시 둘을 호출한다. 이 훅은 백로그에 있던 "외부 재색인 후 하이라이트 낡음" 항목도 함께 해소한다.
- **워처**: `onDidChange`/`onDidCreate` → 역산 후 `updateFile`, `onDidDelete` → `removeFile`. **역산이 null이면 침묵**한다 — 초기 설계는 전체 재빌드 폴백이었으나, 열거 함수가 역산과 동일한 규칙을 쓰므로 역산이 null인 파일은 재빌드로도 색인될 수 없다(2026-08-05 Task 5 리뷰에서 증명). 폴백은 이득 없이 진행 중 증분을 덮어쓸 위험만 있어 제거했다. 갱신 후 `refreshAll()` 호출.

## 4. 테스트 전략
- **열거 등가성**: 세 비동기 열거가 동기 버전과 같은 결과(정렬 후 deepEqual).
- **빌드 등가성**: 세 색인에서 sync vs async 빌드 후 대표 조회가 동일.
- **진행률 콜백**: 최소 1회(완료 시점) 호출, `done ≤ total`.
- **증분**: 각 색인에서 `updateFile`로 값이 바뀌는지, `removeFile`로 사라지는지, 그리고 **전체 재빌드 결과와 동일한 상태가 되는지**(증분이 전체와 수렴하는지 — 가장 중요한 성질).
- **경로 역산**: `componentOfInstallXmlFile`·`langFileMetaOf` 정상/규칙 밖(null).
- **회귀**: 기존 183건 녹색.

## 5. 성공 기준
- 활성화 경로에 `readFileSync`/`readdirSync`가 남지 않음(비동기 빌드 사용) — 코드 검사로 확인.
- 증분 갱신 결과가 전체 재빌드와 동일함을 테스트로 실증.
- 기존 183건 무회귀 + 신규 ~25건, lint/compile/test-tsc 통과, 백로그 5번·7번(일부) 완료 반영.
