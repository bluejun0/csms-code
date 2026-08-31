# CSMS Code — 사용처 색인 성능: 병렬 스캔 + 디스크 캐시 설계

- **작성일**: 2026-08-31
- **상태**: 설계 확정(사용자 승인) — 구현 계획 작성 단계
- **요청**: "혹시 이걸 빠르게 하려면 미리 트리를 구성해야 하는거죠? … 디스크를 좀 쓰는게 나을 것 같네요"
- **범위 확정**: ① 디렉터리 순회·파일 읽기 병렬화 ② 사용처 색인의 디스크 캐시(stale-while-revalidate). 두 단계 한 사이클.

---

## 1. 배경과 측정

0.15.0~0.19.0에서 lang·mustache·`amd/src`·settings.php에 "사용 N건" 버튼을 붙였다. 버튼은 발견 수단인데, 색인이 없는 상태에서 누르면 hlulxp 기준 웜 8~11초·콜드 53초를 기다린다. 첫 클릭이 그만큼 걸리면 버튼의 값어치가 깎인다.

**전제 정정**: 이 색인은 **AST(트리)를 들고 있지 않다.** tree-sitter 트리는 팩트 추출 직후 `delete()`되고(`tree-sitter-php-syntax.ts`), 문서 팩트 캐시는 LRU 8개다. 사용처 색인은 정규식으로 뽑은 **위치 목록**만 보관한다. 따라서 "미리 트리를 만든다"가 아니라 "색인을 미리/빨리 만든다"가 문제이고, 비용은 메모리보다 I/O다.

### 실측 (hlulxp, 색인 대상 24,717개, 웜 기준·같은 세션 반복)

| 구간 | 현재 | 원인·개선 여지 |
|---|---|---|
| 디렉터리 순회 | 3.4초 (콜드 18.9초) | 디렉터리마다 `realpath` 호출(순환 가드). 링크에만 호출 → **1.0초**, 하위 병렬까지 → **0.6~1.6초** |
| 파일 읽기+추출 | 16.2초(순차) | 동시 8개 **4.3초**, 16개 6.0초, 32개 **3.7초**, 64개 3.8초 (측정 편차 있음) |
| 전체 빌드 | **8.5~11.2초** (콜드 53.5초) | 위 둘을 고치면 **~5초** |
| 스냅샷 직렬화 | — | 컬럼형 JSON 2.6MB / **560ms**, gzip(level 1) **0.6MB·27ms** |
| 캐시 로드 | — | 파일 읽기 + gunzip 8ms + JSON 파싱 512ms = **~0.5초** |
| stat 전체(순차) | — | 3.6초 — 검증 경로는 병렬로 낮춘다 |
| 메모리 | 힙 +100MB (RSS +105~121MB), 항목 55,568건 | 캐시 로드 경로도 같은 자료구조라 동일. 창(확장 호스트)마다 별개 |

메모리는 사용자가 "어쩔 수 없다"로 수용했다. 창마다 100MB이고, 참조 기능을 쓴 창에서만 붙는다(lazy 유지 — 예열은 하지 않는다).

## 2. 목표

1. **전체 빌드를 절반으로**: 순회에서 불필요한 `realpath`를 없애고 하위 디렉터리를 병렬로, 읽기를 동시 여러 개로. 결과(항목·위치·순서)는 현재와 **동일**해야 한다.
2. **두 번째부터 즉시**: 색인을 디스크에 저장하고, 다음에는 0.5초에 로드해 바로 쓸 수 있게 한다. 로드 직후 백그라운드로 검증(빠른 순회 + 병렬 stat)해 바뀐 파일만 다시 읽는다.
3. 캐시가 없거나 못 믿을 상태면 지금과 똑같이 동작한다(진행률 알림 + 전체 빌드).
4. 설정 `csmscode.usageIndex.cache`(기본 `true`)로 캐시를 끌 수 있다.

### 비목표
- **예열(활성화 시 미리 빌드)**: 창을 여러 개 띄우는 사용 습관에서 참조를 안 쓰는 창까지 100MB·수 초를 물린다. lazy 유지.
- **다른 색인의 캐시**: 테이블·lang·템플릿·AMD·설정 선언 색인은 각각 1초 미만이라 이득이 없다.
- 메모리 다이어트(위치를 typed array로 등) — 별도 사이클.
- 창 사이 조율: 같은 워크스페이스를 여러 창이 열면 각자 쓰고 마지막 쓰기가 남는다(각 스냅샷은 자기 시점의 온전한 상태 — 원자적 쓰기로 깨지지 않는다).
- 오래된 워크스페이스의 캐시 파일 정리(수명 관리) — 워크스페이스당 약 1MB. 백로그.

## 3. 아키텍처

### 3.1 1단계: 순회·읽기 병렬화 (`php-usage-index.ts`)

**순회** — `listSourceFiles`:
- `realpath`는 **심볼릭 링크로 진입할 때만** 호출한다(루트 진입 1회 포함). 순환 가드는 그대로: 링크로 들어간 디렉터리의 realpath를 `seen`에 기록하고 재방문을 막는다. 일반 디렉터리 계층으로는 순환이 생길 수 없다.
- 하위 디렉터리 탐색을 `Promise.all`로 병렬화한다. libuv 스레드풀이 실제 동시 실행 수를 제한하므로 파일 디스크립터가 폭주하지 않는다.
- 제외 규칙(`SKIP_DIRS`·`isIndexableSourcePath`)·깨진 링크 무시는 그대로.

**읽기** — `buildFromRoot`:
- 파일 목록을 **크기 16의 청크**로 끊어, 청크 안에서는 `Promise.all`로 `stat`+`readFile`을 동시에 하고, **적용(`updateFileText`)은 파일 순서대로** 한다. 그래야 항목 배열의 순서가 지금과 동일해 "증분이 전체 재빌드와 수렴" 성질과 기존 위치 테스트가 유지된다.
- 청크마다 진행률 콜백과 이벤트 루프 양보를 유지한다(현재 200개마다 → 청크 경계, 총량은 비슷).
- 읽기 실패 파일은 지금처럼 건너뛴다(침묵).

### 3.2 파일 스탬프

캐시 검증은 파일 내용을 다시 읽지 않고 `mtimeMs`+`size`로 판정한다. 색인이 **스캔한 모든 파일**의 스탬프를 기억한다 — 항목이 없는 파일(24,717 중 16,510)까지 담아야 다음 검증에서 그것들을 다시 읽지 않는다.

```ts
export interface FileStamp { mtimeMs: number; size: number; }
```

색인 내부는 절대 경로 → `FileStamp` 맵으로 들고, 스냅샷에 쓸 때만 루트 상대 경로로 바꾼다.

`updateFileText(uri, text, stamp?)` — 세 번째 인자를 넓힌다.
- 빌드·검증 경로는 방금 읽은 스탬프를 함께 넘겨 기록한다.
- 저장 증분 경로(동기, `onDidSaveTextDocument`)는 넘기지 않는다 → 그 파일 스탬프를 **지운다**. 다음 검증에서 "디스크에 있는데 스탬프가 없는 파일"로 잡혀 한 번 다시 읽힌다(정확성 우선, 비용은 파일 한두 개).

### 3.3 2단계: 스냅샷(순수) — `src/infrastructure/usage/usage-snapshot.ts`

fs·zlib을 모르는 순수 모듈. 형식·검증·diff·행 인코딩만 담당한다.

```ts
export const SNAPSHOT_VERSION = 1;

export interface UsageSnapshot {
  v: number;            // 형식 버전
  ext: string;          // 확장 버전 — 추출 규칙이 바뀌면 옛 색인은 거짓말을 한다
  root: string;
  files: [rel: string, mtimeMs: number, size: number][];   // 스캔한 전부
  s: (string | number)[];   // 문자열: [fileIdx, n, (component, key, line, column) × n] 반복
  t: (string | number)[];   // 템플릿: [fileIdx, n, (ref, line, column) × n]
  a: (string | number)[];   // AMD:   같은 모양
  c: (string | number)[];   // 설정:  [fileIdx, n, (id, line, column) × n]
}

/** 형태·버전·확장 버전·루트가 모두 맞아야 쓸 수 있다. 하나라도 어긋나면 캐시를 버린다(침묵). */
export function isSnapshotUsable(value: unknown, root: string, extVersion: string): value is UsageSnapshot;

/** 캐시 스탬프와 현재 스탬프를 비교 — 결과는 루트 상대 경로. */
export function diffStamps(cached: readonly [string, number, number][],
                           current: readonly [string, number, number][]): { changed: string[]; removed: string[] };

/** 행 인코딩 — 파일별 목록을 평평한 배열로, 되돌리기. */
export function packRows<T>(fileIdx: number, list: readonly T[], row: (e: T) => (string | number)[]): (string | number)[];
export function unpackRows(flat: readonly (string | number)[], width: number,
                           apply: (fileIdx: number, cells: readonly (string | number)[]) => void): void;
```

`diffStamps` 규칙: 현재에만 있음 → changed(새 파일), 양쪽에 있고 mtime·size 중 하나라도 다름 → changed, 캐시에만 있음 → removed.

### 3.4 캐시 파일 I/O — `src/infrastructure/usage/usage-index-cache.ts`

```ts
export class UsageIndexCache {
  constructor(dir: string, root: string, extVersion: string);
  /** 없거나 손상·버전 불일치면 null(침묵). */
  read(): Promise<UsageSnapshot | null>;
  /** 임시 파일에 쓰고 rename — 창이 여럿이어도 반쪽 파일이 보이지 않는다. */
  write(snap: UsageSnapshot): Promise<void>;
}
```
- 파일명: `usage-<sha1(root) 앞 16자>.json.gz`. 디렉터리는 `globalStorageUri.fsPath`(없으면 만든다).
- gzip level 1(27ms·0.6MB) — 압축률보다 시간이 중요하다.
- 모든 실패(디렉터리 없음·권한·손상·JSON 오류)는 잡아서 `null`/무시. 캐시 때문에 기능이 죽지 않는다.

### 3.5 색인의 캐시 경로 — `php-usage-index.ts`

```ts
toSnapshot(root: string, extVersion: string): UsageSnapshot;
/** 맵과 스탬프를 스냅샷으로 교체하고 isBuilt를 세운다. */
loadSnapshot(snap: UsageSnapshot, root: string): void;
/** 빠른 순회 + 병렬 stat로 diff → 바뀐 파일만 다시 읽고 지워진 파일은 제거. 바뀐 것이 있으면 true. */
revalidateFromRoot(root: string): Promise<boolean>;
```
`loadSnapshot`은 `hasCanonical`을 다시 적용하지 않는다 — 컴포넌트 정규화는 **쓰는 시점에** 끝나 스냅샷에 canonical 이름이 들어 있다. lang 색인이 그 사이 달라져 정규화 결과가 바뀔 수 있는데, 그건 검증이 파일을 다시 읽을 때 함께 고쳐진다(lang 파일이 바뀌었다면 그 파일도 changed로 잡힌다).

### 3.6 결선 (`extension.ts`)

```ts
const usageCache = new UsageIndexCache(ctx.globalStorageUri.fsPath, root, extensionVersion);
const cacheEnabled = () => vscode.workspace.getConfiguration('csmscode').get<boolean>('usageIndex.cache', true);

build: cb => usageBuild ??= (async () => {
  const snap = cacheEnabled() ? await usageCache.read() : null;
  if (snap) {
    usageIndex.loadSnapshot(snap, root);          // ~0.5초, 알림 없음
    refreshLenses();
    void (async () => {                            // 백그라운드 검증
      if (await usageIndex.revalidateFromRoot(root)) { refreshLenses(); highlight.refreshAll(); }
      if (cacheEnabled()) await usageCache.write(usageIndex.toSnapshot(root, extensionVersion));
    })();
    return;
  }
  await usageIndex.buildFromRoot(root, cb);        // 진행률 알림(기존 경로)
  refreshLenses();
  if (cacheEnabled()) void usageCache.write(usageIndex.toSnapshot(root, extensionVersion));
})();
```
- `ensureUsageIndex`의 진행률 알림은 **캐시 미스에만** 뜬다. 히트면 조용히 즉시.
- 저장·삭제 증분 뒤에는 디바운스(10초)로 캐시를 다시 쓴다(쓰기 45ms).
- 확장 버전은 `ctx.extension.packageJSON.version`.

## 4. 침묵·오류 규칙

- 캐시 없음·손상·버전 불일치·루트 불일치 → 조용히 전체 빌드.
- 캐시 쓰기 실패(권한·디스크) → 콘솔 로그만. 기능은 정상.
- 검증 중 읽기 실패 파일 → 건너뛴다(그 파일 항목만 없음).
- 캐시 로드 직후 잠깐은 마지막 세션 기준 결과다. 이 색인은 이미 "저장 시점 기준"(미저장 편집 미반영) 제한이 있어 성격이 같다 — 문서에 함께 적는다.

## 5. 테스트 계획

**1단계**
- 심볼릭 링크: 링크된 플러그인 디렉터리 안의 파일이 색인되고, 자기 자신을 가리키는 링크에서 멈추며(순환), 깨진 링크는 무시된다(런타임 tmp + `symlinkSync` — resolver 테스트와 같은 관용구).
- 진행률 콜백이 여전히 호출되고 total이 파일 수와 같다.
- 기존 위치·증분 테스트가 그대로 통과(순서 보존의 핀).

**2단계**
- `diffStamps`: 변경·추가·삭제·동일 네 경우.
- `isSnapshotUsable`: 형식 버전 불일치, 확장 버전 불일치, 루트 불일치, 널·필드 누락.
- 스냅샷 왕복: mini-moodle로 빌드 → `toSnapshot` → 새 색인 `loadSnapshot` → `referencesOf`·`templateRefsOf`·`amdRefsOf`·`configRefsOf`가 모두 동일하고 `isBuilt`가 참.
- 캐시 파일 왕복(tmp 디렉터리): `write` → `read`가 같은 스냅샷, 없는 파일 → null, 손상 파일 → null, 확장 버전이 다른 캐시 → null.
- `revalidateFromRoot`(tmp 루트): 파일 수정 → 그 파일만 반영, 삭제 → 항목 사라짐, 새 파일 → 항목 추가, 아무것도 안 바뀌면 false.
- 저장 증분(`updateFileText`에 스탬프 없이) 후 그 파일이 다음 검증에서 다시 읽힌다.

## 6. 문서·버전

README(기능·설정·알려진 제한), CHANGELOG **0.20.0**(성능 특성 변경 + 새 설정), 백로그(캐시 파일 수명 관리·메모리 다이어트를 후속으로), 수동 검증 항목(첫 클릭 시간, 두 번째 창에서 즉시, 외부 변경 반영, 설정 끄기).
