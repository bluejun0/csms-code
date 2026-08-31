# 사용처 색인 성능(병렬 스캔 + 디스크 캐시) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용처 색인 전체 빌드를 8.5~11초에서 ~5초로 줄이고, 두 번째부터는 디스크 캐시로 0.5초에 쓸 수 있게 한다(로드 후 백그라운드 검증).

**Architecture:** 1단계는 `php-usage-index.ts` 안의 순회·읽기만 고친다(결과 동일). 2단계는 순수 모듈(`usage-snapshot.ts`: 형식·검증·diff·행 인코딩)과 fs·gzip 모듈(`usage-index-cache.ts`: 원자적 읽기·쓰기)을 새로 두고, 색인에 `toSnapshot`/`loadSnapshot`/`revalidateFromRoot`를 더한다. 컴포지션 루트는 "캐시 히트면 조용히 로드 + 백그라운드 검증, 미스면 기존 진행률 빌드" 분기만 갖는다.

**Tech Stack:** TypeScript, Node fs/zlib/crypto, mocha + ts-node, VS Code API.

**Spec:** `docs/superpowers/specs/2026-08-31-usage-index-cache-design.md` — 충돌 시 스펙이 우선.

## Global Constraints

- 계층 규칙(eslint 강제): `domain/`은 fs·path·vscode 금지, `application/`은 infrastructure·vscode 금지, presentation은 infrastructure를 import하지 않는다.
- **1단계는 결과를 바꾸지 않는다**: 항목·위치·배열 순서가 순차 빌드와 동일해야 한다(기존 테스트가 핀).
- 캐시 실패는 어떤 경우에도 기능을 죽이지 않는다(침묵 원칙: null 반환 + 전체 빌드).
- lazy 유지 — 활성화 시 예열하지 않는다.
- 주석은 객관적으로만(날짜·리뷰·백로그 번호 금지).
- 각 Task 끝에 `npm run test:unit`·`npm run compile`·`npm run lint` 녹색. 기존 482건 무회귀.
- 런타임 tmp 디렉터리는 `fs.mkdtempSync(join(os.tmpdir(), 'csms-…'))` + `after`에서 `rmSync`(resolver 테스트 관용구).

---

### Task 1: 빠른 순회 + 병렬 읽기 + 파일 스탬프

**Files:**
- Modify: `src/infrastructure/usage/php-usage-index.ts`
- Test: `test/unit/infra/php-usage-index.test.ts`

**Interfaces (Produces):**
```ts
export interface FileStamp { mtimeMs: number; size: number; }
// PhpUsageIndex
updateFileText(uri: string, text: string, stamp?: FileStamp): void   // stamp 있으면 기록, 없으면 그 파일 스탬프 삭제
```

- [ ] **Step 1: 실패하는 테스트** — 심볼릭 링크 순회(순환·깨진 링크)와 스탬프 기록

`test/unit/infra/php-usage-index.test.ts` 맨 아래에 추가:
```ts
describe('PhpUsageIndex — 순회(심볼릭 링크·순환)', () => {
  let tmp: string;
  before(() => {
    tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-usage-walk-'));
    fs.mkdirSync(join(tmp, 'root', 'local', 'real'), { recursive: true });
    fs.mkdirSync(join(tmp, 'target'), { recursive: true });
    fs.writeFileSync(join(tmp, 'root', 'local', 'real', 'a.php'), "<?php\nget_string('k1', 'local_x');\n");
    fs.writeFileSync(join(tmp, 'target', 'b.php'), "<?php\nget_string('k2', 'local_x');\n");
    fs.symlinkSync(join(tmp, 'target'), join(tmp, 'root', 'local', 'linked'), 'dir');
    fs.symlinkSync(join(tmp, 'root'), join(tmp, 'root', 'local', 'loop'), 'dir');       // 순환
    fs.symlinkSync(join(tmp, 'nowhere'), join(tmp, 'root', 'local', 'broken'), 'dir');  // 깨진 링크
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('링크된 디렉터리는 색인하고, 순환·깨진 링크에서 멈추지 않는다', async () => {
    const idx = new PhpUsageIndex(() => true);
    await idx.buildFromRoot(join(tmp, 'root'));
    assert.equal(idx.referencesOf('local_x', 'k1').length, 1, '실디렉터리');
    assert.equal(idx.referencesOf('local_x', 'k2').length, 1, '링크된 디렉터리');
  });
});

describe('PhpUsageIndex — 파일 스탬프', () => {
  it('빌드는 스탬프를 기록하고, 스탬프 없는 갱신은 그 파일 스탬프를 지운다', async () => {
    const tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-usage-stamp-'));
    try {
      const f = join(tmp, 'x.php');
      fs.writeFileSync(f, "<?php\nget_string('k', 'local_x');\n");
      const idx = new PhpUsageIndex(() => true);
      await idx.buildFromRoot(tmp);
      const stamps = (idx as unknown as { stamps: Map<string, { size: number }> }).stamps;
      assert.equal(stamps.size, 1);
      assert.ok(stamps.get(f)!.size > 0);
      idx.updateFileText(f, "<?php\n");            // 저장 증분 — 스탬프 없이
      assert.equal(stamps.has(f), false, '다음 검증에서 다시 읽도록 표시');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
});
```
파일 상단 import에 `import * as fs from 'fs'; import * as os from 'os';` 필요(없으면 추가).

- [ ] **Step 2: RED 확인** — `npx mocha --no-config -r ts-node/register --timeout 20000 test/unit/infra/php-usage-index.test.ts`. 순회 테스트는 순환 링크에서 무한 진행/타임아웃 또는 통과, 스탬프 테스트는 `stamps` 없음으로 실패.

- [ ] **Step 3: 구현**

상수·타입:
```ts
const YIELD_EVERY = 200;
const READ_CHUNK = 16;   // 읽기 동시 수 — 실측 8~32에서 평탄
const STAT_CHUNK = 64;   // stat은 읽기보다 싸다

/** 캐시 검증용 파일 도장 — 내용을 다시 읽지 않고 mtime·size로 판정한다. */
export interface FileStamp { mtimeMs: number; size: number; }
```
필드 추가: `private stamps = new Map<string, FileStamp>();`

`buildFromRoot` 교체:
```ts
  async buildFromRoot(root: string, onProgress?: (done: number, total: number) => void): Promise<void> {
    const files = await listSourceFiles(root);
    let done = 0, lastYield = 0;
    // 읽기는 청크 안에서 병렬로, 적용은 파일 순서대로 — 항목 배열의 순서가 순차 빌드와 같아야 한다.
    for (let i = 0; i < files.length; i += READ_CHUNK) {
      const chunk = files.slice(i, i + READ_CHUNK);
      const read = await Promise.all(chunk.map(readWithStamp));
      for (const r of read) if (r) this.updateFileText(r.file, r.text, r.stamp);
      done += chunk.length;
      if (done - lastYield >= YIELD_EVERY) {
        lastYield = done;
        onProgress?.(done, files.length);
        await new Promise<void>(r => setImmediate(r)); // 이벤트 루프 양보 — 확장 호스트 블록 방지
      }
    }
    onProgress?.(files.length, files.length);
    this.builtFlag = true;
  }
```
`updateFileText` 시그니처와 스탬프 반영:
```ts
  /** 파일 단위 증분: 기존 항목 제거 후 재추출. 확장자로 PHP/JS 추출기를 고른다.
   *  `stamp`를 주면 기록하고, 주지 않으면 지운다 — 저장 증분은 mtime을 모르므로 다음 검증에서 다시 확인한다. */
  updateFileText(uri: string, text: string, stamp?: FileStamp): void {
    if (stamp) this.stamps.set(uri, stamp); else this.stamps.delete(uri);
    // …기존 본문 그대로…
  }
```
파일 하단 헬퍼:
```ts
async function readWithStamp(file: string): Promise<{ file: string; text: string; stamp: FileStamp } | null> {
  try {
    const [st, text] = await Promise.all([fs.promises.stat(file), fs.promises.readFile(file, 'utf8')]);
    return { file, text, stamp: { mtimeMs: st.mtimeMs, size: st.size } };
  } catch { return null; }
}
```
`listSourceFiles` 교체 — realpath는 링크 진입에만, 하위는 병렬:
```ts
/** 루트 재귀 소스 파일(.php/.js/.mustache) 열거. 채택 여부는 isIndexableSourcePath로 통일해
 *  콜드 스캔과 저장 증분의 제외 규칙이 갈라지지 않게 한다.
 *  realpath는 심볼릭 링크로 진입할 때만 부른다 — 일반 디렉터리 계층으로는 순환이 생길 수 없고,
 *  디렉터리마다 부르면 열거 비용이 몇 배가 된다. */
async function listSourceFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const seenLinks = new Set<string>();
  async function walk(dir: string, viaLink: boolean): Promise<void> {
    if (viaLink) {
      let real: string;
      try { real = await fs.promises.realpath(dir); } catch { return; }
      if (seenLinks.has(real)) return;
      seenLinks.add(real);
    }
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    const subs: Promise<void>[] = [];
    for (const d of entries) {
      if (SKIP_DIRS.has(d.name)) continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) subs.push(walk(p, false));
      else if (d.isSymbolicLink()) {
        subs.push((async () => {
          try { if ((await fs.promises.stat(p)).isDirectory()) await walk(p, true); } catch { /* 깨진 링크 무시 */ }
        })());
      } else if (d.isFile() && isIndexableSourcePath(root, p)) out.push(p);
    }
    await Promise.all(subs);
  }
  await walk(root, true);
  return out;
}
```
주의: 순환 가드가 링크에만 걸리므로 `root` 진입은 `viaLink = true`로 시작한다(루트 자신이 링크일 수 있다).

- [ ] **Step 4: GREEN 확인** — 위 두 describe 통과 + 전체 `npm run test:unit`(482 + 2건). `npm run compile`·`npm run lint`.

- [ ] **Step 5: 실측 기록** — hlulxp에서 전과 후를 재고 숫자를 커밋 메시지에 남긴다.
```bash
cat > /tmp/bench.ts <<'TS'
import { PhpUsageIndex } from '/home/user/workspace/vscode-csms-code/src/infrastructure/usage/php-usage-index';
(async () => {
  for (const n of [1, 2]) {
    const t = Date.now(); const i = new PhpUsageIndex(() => true);
    await i.buildFromRoot('/home/user/workspace/hlulxp');
    console.log(`${n}회차: ${Date.now() - t}ms`);
  }
})();
TS
TS_NODE_TRANSPILE_ONLY=1 TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node","target":"ES2021"}' node -r ts-node/register /tmp/bench.ts
```

- [ ] **Step 6: 커밋** — `perf(infra): 사용처 색인 순회·읽기 병렬화 + 파일 스탬프`

---

### Task 2: 스냅샷 순수 모듈

**Files:**
- Create: `src/infrastructure/usage/usage-snapshot.ts`
- Test: `test/unit/infra/usage-snapshot.test.ts`

**Interfaces (Produces):** 스펙 §3.3의 `SNAPSHOT_VERSION`·`UsageSnapshot`·`isSnapshotUsable`·`diffStamps`·`packRows`·`unpackRows`.

- [ ] **Step 1: 실패하는 테스트**

```ts
import { strict as assert } from 'assert';
import { SNAPSHOT_VERSION, UsageSnapshot, diffStamps, isSnapshotUsable, packRows, unpackRows } from '../../../src/infrastructure/usage/usage-snapshot';

const snap: UsageSnapshot = { v: SNAPSHOT_VERSION, ext: '1.2.3', root: '/m', files: [], s: [], t: [], a: [], c: [] };

describe('isSnapshotUsable', () => {
  it('버전·확장 버전·루트가 모두 맞으면 쓸 수 있다', () =>
    assert.equal(isSnapshotUsable(snap, '/m', '1.2.3'), true));
  it('형식 버전이 다르면 버린다', () =>
    assert.equal(isSnapshotUsable({ ...snap, v: SNAPSHOT_VERSION + 1 }, '/m', '1.2.3'), false));
  it('확장 버전이 다르면 버린다 — 추출 규칙이 바뀌었을 수 있다', () =>
    assert.equal(isSnapshotUsable({ ...snap, ext: '1.2.2' }, '/m', '1.2.3'), false));
  it('루트가 다르면 버린다', () => assert.equal(isSnapshotUsable(snap, '/other', '1.2.3'), false));
  it('형태가 아니면 버린다(널·필드 누락·배열 아님)', () => {
    assert.equal(isSnapshotUsable(null, '/m', '1.2.3'), false);
    assert.equal(isSnapshotUsable({ v: SNAPSHOT_VERSION, ext: '1.2.3', root: '/m' }, '/m', '1.2.3'), false);
    assert.equal(isSnapshotUsable({ ...snap, files: 'x' }, '/m', '1.2.3'), false);
  });
});

describe('diffStamps', () => {
  const cached: [string, number, number][] = [['a.php', 100, 10], ['b.php', 100, 10], ['gone.php', 100, 10]];
  const current: [string, number, number][] = [['a.php', 100, 10], ['b.php', 200, 10], ['new.php', 100, 10]];
  it('mtime·size가 다르면 changed, 현재에만 있으면 changed, 캐시에만 있으면 removed', () => {
    const d = diffStamps(cached, current);
    assert.deepEqual(d.changed.sort(), ['b.php', 'new.php']);
    assert.deepEqual(d.removed, ['gone.php']);
  });
  it('size만 달라도 changed', () => {
    const d = diffStamps([['a.php', 100, 10]], [['a.php', 100, 11]]);
    assert.deepEqual(d.changed, ['a.php']);
  });
  it('같으면 아무것도 없다', () => {
    const d = diffStamps(cached, cached);
    assert.deepEqual(d, { changed: [], removed: [] });
  });
});

describe('packRows·unpackRows 왕복', () => {
  it('파일별 목록을 평평하게 담고 되돌린다', () => {
    const flat = packRows<[string, number]>([[0, [['k1', 7], ['k2', 8]]], [3, [['k3', 9]]]], e => [e[0], e[1]]);
    const seen: [number, string, number][] = [];
    unpackRows(flat, 2, (fi, row) => seen.push([fi, row[0] as string, row[1] as number]));
    assert.deepEqual(seen, [[0, 'k1', 7], [0, 'k2', 8], [3, 'k3', 9]]);
  });
  it('빈 목록은 아무것도 남기지 않는다', () => {
    assert.deepEqual(packRows<[string]>([[1, []]], e => [e[0]]), []);
  });
});
```

- [ ] **Step 2: RED 확인** — 모듈 없음.

- [ ] **Step 3: 구현**

```ts
/** 사용처 색인의 디스크 표현 — 형식·검증·비교·행 인코딩만. fs·zlib을 모른다. */
export const SNAPSHOT_VERSION = 1;

/** 파일 도장 행 — [루트 상대 경로, mtimeMs, size]. size가 음수면 "모름"(다음 검증에서 다시 읽는다). */
export type StampRow = [string, number, number];

export interface UsageSnapshot {
  v: number;
  /** 확장 버전 — 추출 규칙이 바뀌면 옛 색인은 거짓말을 한다. */
  ext: string;
  root: string;
  files: StampRow[];
  s: (string | number)[];   // 문자열: [fileIdx, n, (component, key, line, column) × n]
  t: (string | number)[];   // 템플릿: [fileIdx, n, (ref, line, column) × n]
  a: (string | number)[];   // AMD
  c: (string | number)[];   // 설정: [fileIdx, n, (id, line, column) × n]
}

export function isSnapshotUsable(value: unknown, root: string, extVersion: string): value is UsageSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Partial<UsageSnapshot>;
  if (s.v !== SNAPSHOT_VERSION || s.ext !== extVersion || s.root !== root) return false;
  return Array.isArray(s.files) && Array.isArray(s.s) && Array.isArray(s.t) && Array.isArray(s.a) && Array.isArray(s.c);
}

/** 캐시 시점과 현재의 도장을 비교. 결과는 루트 상대 경로. */
export function diffStamps(cached: readonly StampRow[], current: readonly StampRow[]): { changed: string[]; removed: string[] } {
  const before = new Map(cached.map(([rel, mtimeMs, size]) => [rel, `${mtimeMs}:${size}`] as const));
  const changed: string[] = [];
  const seen = new Set<string>();
  for (const [rel, mtimeMs, size] of current) {
    seen.add(rel);
    if (before.get(rel) !== `${mtimeMs}:${size}`) changed.push(rel);
  }
  const removed = cached.map(([rel]) => rel).filter(rel => !seen.has(rel));
  return { changed, removed };
}

export function packRows<T>(byFile: Iterable<[number, readonly T[]]>, row: (e: T) => (string | number)[]): (string | number)[] {
  const out: (string | number)[] = [];
  for (const [fileIdx, list] of byFile) {
    if (!list.length) continue;
    out.push(fileIdx, list.length);
    for (const e of list) out.push(...row(e));
  }
  return out;
}

export function unpackRows(flat: readonly (string | number)[], width: number,
                           apply: (fileIdx: number, row: readonly (string | number)[]) => void): void {
  let i = 0;
  while (i + 1 < flat.length) {
    const fileIdx = flat[i++] as number;
    const n = flat[i++] as number;
    for (let k = 0; k < n; k++) { apply(fileIdx, flat.slice(i, i + width)); i += width; }
  }
}
```

- [ ] **Step 4: GREEN + 커밋** — `feat(infra): 사용처 색인 스냅샷 형식·검증·비교(순수)`

---

### Task 3: 색인의 스냅샷 왕복

**Files:**
- Modify: `src/infrastructure/usage/php-usage-index.ts`
- Test: `test/unit/infra/php-usage-index.test.ts`

**Interfaces (Produces):** `toSnapshot(root, extVersion)`, `loadSnapshot(snap, root)`

- [ ] **Step 1: 실패하는 테스트**

```ts
describe('PhpUsageIndex — 스냅샷 왕복', () => {
  it('빌드한 색인을 스냅샷으로 저장하고 되돌리면 네 조회가 모두 같다', async () => {
    const src = new PhpUsageIndex(hasCanonical);
    await src.buildFromRoot(root);
    const snap = src.toSnapshot(root, '9.9.9');
    assert.equal(snap.ext, '9.9.9');
    assert.equal(snap.root, root);
    assert.ok(snap.files.length >= 1);

    const loaded = new PhpUsageIndex(() => false);   // hasCanonical을 안 써도 같아야 한다(canonical이 스냅샷에 있다)
    assert.equal(loaded.isBuilt, false);
    loaded.loadSnapshot(snap, root);
    assert.equal(loaded.isBuilt, true);
    for (const [c, k] of [['local_ubattend', 'attendance_book'], ['mod_testmod', 'pluginname'], ['core', 'ok']] as const) {
      assert.deepEqual(loaded.referencesOf(c, k), src.referencesOf(c, k), `${c}/${k}`);
    }
    assert.deepEqual(loaded.templateRefsOf('local_ubattend', 'setting'), src.templateRefsOf('local_ubattend', 'setting'));
    assert.deepEqual(loaded.amdRefsOf('local_ubattend', 'setting'), src.amdRefsOf('local_ubattend', 'setting'));
    assert.deepEqual(loaded.configRefsOf('local_ubattend', 'attendlimit'), src.configRefsOf('local_ubattend', 'attendlimit'));
  });
  it('되돌린 색인도 증분 갱신이 된다(파일별 역인덱스가 복원됨)', async () => {
    const src = new PhpUsageIndex(hasCanonical);
    await src.buildFromRoot(root);
    const loaded = new PhpUsageIndex(() => false);
    loaded.loadSnapshot(src.toSnapshot(root, '1'), root);
    const uri = join(root, 'local/ubattend/view.php');
    assert.ok(loaded.referencesOf('local_ubattend', 'attendance_book').some(r => r.uri === uri));
    loaded.updateFileText(uri, '<?php\n');
    assert.equal(loaded.referencesOf('local_ubattend', 'attendance_book').filter(r => r.uri === uri).length, 0);
  });
});
```
(`hasCanonical`·`root`는 이 파일 상단에 이미 있다. 이 describe는 모듈 최상단 `idx`를 건드리지 않는 별도 인스턴스만 쓴다.)

- [ ] **Step 2: RED 확인.**

- [ ] **Step 3: 구현** — 먼저 `updateFileText`의 적용부를 재사용 가능하게 뺀다.

```ts
  updateFileText(uri: string, text: string, stamp?: FileStamp): void {
    const extracted = uri.endsWith('.js') ? this.extractJs(uri, text)
      : uri.endsWith('.mustache') ? this.extractMustache(uri, text)
        : this.extractPhp(uri, text);
    this.applyExtracted(uri, extracted, stamp);
  }

  /** 추출 결과를 색인에 반영하는 단일 지점 — 스캔·증분·스냅샷 복원이 모두 이 경로를 지난다. */
  private applyExtracted(uri: string, { entries, tEntries, aEntries, cEntries }: Extracted, stamp?: FileStamp): void {
    if (stamp) this.stamps.set(uri, stamp); else this.stamps.delete(uri);
    const prev = this.byFile.get(uri);
    if (prev) { for (const e of prev) this.removeEntry(e); this.byFile.delete(uri); }
    const prevT = this.templatesByFile.get(uri);
    if (prevT) { for (const e of prevT) this.removeTemplateEntry(e); this.templatesByFile.delete(uri); }
    const prevA = this.amdByFile.get(uri);
    if (prevA) { for (const e of prevA) this.removeAmdEntry(e); this.amdByFile.delete(uri); }
    const prevC = this.configByFile.get(uri);
    if (prevC) { for (const e of prevC) this.removeConfigEntry(e); this.configByFile.delete(uri); }

    for (const e of entries) this.addEntry(e);
    for (const e of tEntries) this.addTemplateEntry(e);
    for (const e of aEntries) this.addAmdEntry(e);
    for (const e of cEntries) this.addConfigEntry(e);
    if (entries.length) this.byFile.set(uri, entries);
    if (tEntries.length) this.templatesByFile.set(uri, tEntries);
    if (aEntries.length) this.amdByFile.set(uri, aEntries);
    if (cEntries.length) this.configByFile.set(uri, cEntries);
  }
```

스냅샷:
```ts
  /** 색인이 아는 모든 파일 — 도장이 있는 파일과 항목이 있는 파일의 합집합.
   *  항목만 있고 도장이 없는 파일(저장 증분으로 갱신된 파일)은 size 음수로 담아 다음 검증에서 다시 읽는다. */
  private trackedFiles(): string[] {
    return [...new Set([...this.stamps.keys(), ...this.byFile.keys(), ...this.templatesByFile.keys(),
      ...this.amdByFile.keys(), ...this.configByFile.keys()])];
  }

  toSnapshot(root: string, extVersion: string): UsageSnapshot {
    const files = this.trackedFiles().filter(f => insideRoot(root, f));
    const idxOf = new Map(files.map((f, i) => [f, i] as const));
    const rows = <T>(m: Map<string, T[]>): Iterable<[number, readonly T[]]> =>
      [...m].flatMap(([f, list]) => { const i = idxOf.get(f); return i === undefined ? [] : [[i, list] as [number, readonly T[]]]; });
    return {
      v: SNAPSHOT_VERSION, ext: extVersion, root,
      files: files.map(f => {
        const s = this.stamps.get(f);
        return [path.relative(root, f), s?.mtimeMs ?? 0, s?.size ?? -1] as StampRow;
      }),
      s: packRows(rows(this.byFile), e => [e.component, e.key, e.loc.line, e.loc.column]),
      t: packRows(rows(this.templatesByFile), e => [e.ref, e.loc.line, e.loc.column]),
      a: packRows(rows(this.amdByFile), e => [e.ref, e.loc.line, e.loc.column]),
      c: packRows(rows(this.configByFile), e => [e.id, e.loc.line, e.loc.column]),
    };
  }

  /** 스냅샷으로 색인을 채운다 — 컴포넌트 정규화는 저장 시점에 끝나 있으므로 다시 하지 않는다. */
  loadSnapshot(snap: UsageSnapshot, root: string): void {
    this.byComponent = new Map(); this.byFile = new Map();
    this.byTemplateRef = new Map(); this.templatesByFile = new Map();
    this.byAmdRef = new Map(); this.amdByFile = new Map();
    this.byConfigId = new Map(); this.configByFile = new Map();
    this.stamps = new Map();

    const files = snap.files.map(([rel]) => path.join(root, rel));
    snap.files.forEach(([, mtimeMs, size], i) => { if (size >= 0) this.stamps.set(files[i], { mtimeMs, size }); });

    const per = new Map<number, Extracted>();
    const slot = (i: number): Extracted => {
      let e = per.get(i);
      if (!e) { e = { entries: [], tEntries: [], aEntries: [], cEntries: [] }; per.set(i, e); }
      return e;
    };
    unpackRows(snap.s, 4, (i, r) => slot(i).entries.push({
      component: r[0] as string, key: r[1] as string,
      loc: { uri: files[i], line: r[2] as number, column: r[3] as number } }));
    unpackRows(snap.t, 3, (i, r) => slot(i).tEntries.push({ ref: r[0] as string, loc: { uri: files[i], line: r[1] as number, column: r[2] as number } }));
    unpackRows(snap.a, 3, (i, r) => slot(i).aEntries.push({ ref: r[0] as string, loc: { uri: files[i], line: r[1] as number, column: r[2] as number } }));
    unpackRows(snap.c, 3, (i, r) => slot(i).cEntries.push({ id: r[0] as string, loc: { uri: files[i], line: r[1] as number, column: r[2] as number } }));

    for (const [i, extracted] of per) {
      const stamp = this.stamps.get(files[i]);
      this.applyExtracted(files[i], extracted, stamp);
    }
    this.builtFlag = true;
  }
```
`insideRoot` 헬퍼(파일 하단):
```ts
/** 루트 밖 경로는 상대 경로로 담을 수 없고 검증도 못 한다 — 스냅샷에서 제외한다. */
function insideRoot(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
```
주의: `applyExtracted`가 `stamp`를 안 받으면 도장을 지우므로, `loadSnapshot`은 위처럼 도장을 먼저 채우고 **그 값을 다시 넘긴다**.

- [ ] **Step 4: GREEN + 커밋** — `feat(infra): 사용처 색인 스냅샷 저장·복원`

---

### Task 4: 캐시 파일 I/O

**Files:**
- Create: `src/infrastructure/usage/usage-index-cache.ts`
- Test: `test/unit/infra/usage-index-cache.test.ts`

**Interfaces (Produces):** `UsageIndexCache { read(): Promise<UsageSnapshot | null>; write(snap): Promise<void>; }`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { UsageIndexCache } from '../../../src/infrastructure/usage/usage-index-cache';
import { SNAPSHOT_VERSION, UsageSnapshot } from '../../../src/infrastructure/usage/usage-snapshot';

const snap = (root: string, ext: string): UsageSnapshot =>
  ({ v: SNAPSHOT_VERSION, ext, root, files: [['a.php', 1, 2]], s: [0, 1, 'local_x', 'k', 3, 4], t: [], a: [], c: [] });

describe('UsageIndexCache', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(join(os.tmpdir(), 'csms-cache-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('쓰고 읽으면 같은 스냅샷', async () => {
    const c = new UsageIndexCache(dir, '/m/root', '1.0.0');
    await c.write(snap('/m/root', '1.0.0'));
    assert.deepEqual(await c.read(), snap('/m/root', '1.0.0'));
  });
  it('없으면 null', async () => assert.equal(await new UsageIndexCache(dir, '/m/root', '1.0.0').read(), null));
  it('확장 버전이 다르면 null — 같은 파일이라도 버린다', async () => {
    await new UsageIndexCache(dir, '/m/root', '1.0.0').write(snap('/m/root', '1.0.0'));
    assert.equal(await new UsageIndexCache(dir, '/m/root', '2.0.0').read(), null);
  });
  it('다른 루트는 다른 파일을 본다', async () => {
    await new UsageIndexCache(dir, '/m/a', '1.0.0').write(snap('/m/a', '1.0.0'));
    assert.equal(await new UsageIndexCache(dir, '/m/b', '1.0.0').read(), null);
  });
  it('손상된 파일이면 null(예외를 던지지 않는다)', async () => {
    const c = new UsageIndexCache(dir, '/m/root', '1.0.0');
    await c.write(snap('/m/root', '1.0.0'));
    const file = fs.readdirSync(dir).find(f => f.endsWith('.json.gz'))!;
    fs.writeFileSync(join(dir, file), Buffer.from('not gzip'));
    assert.equal(await c.read(), null);
  });
  it('디렉터리가 없어도 쓰기가 성공한다(만들어 준다)', async () => {
    const nested = join(dir, 'a', 'b');
    const c = new UsageIndexCache(nested, '/m/root', '1.0.0');
    await c.write(snap('/m/root', '1.0.0'));
    assert.ok(await c.read());
  });
  it('쓰기 실패는 예외를 던지지 않는다', async () => {
    const c = new UsageIndexCache(join(dir, 'x.php', 'nope'), '/m/root', '1.0.0'); // 파일 아래 경로
    fs.writeFileSync(join(dir, 'x.php'), 'x');
    await c.write(snap('/m/root', '1.0.0')); // 던지지 않으면 통과
  });
});
```

- [ ] **Step 2: RED 확인.**

- [ ] **Step 3: 구현**

```ts
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { UsageSnapshot, isSnapshotUsable } from './usage-snapshot';

/** 사용처 색인 스냅샷의 디스크 저장소. 실패는 모두 삼킨다 — 캐시 때문에 기능이 죽지 않는다.
 *  gzip level 1은 압축률보다 시간을 산다(실측 27ms·0.6MB). 쓰기는 임시 파일 + rename으로 원자적이다. */
export class UsageIndexCache {
  private readonly file: string;

  constructor(dir: string, private root: string, private extVersion: string) {
    const key = crypto.createHash('sha1').update(root).digest('hex').slice(0, 16);
    this.file = path.join(dir, `usage-${key}.json.gz`);
  }

  async read(): Promise<UsageSnapshot | null> {
    try {
      const gz = await fs.promises.readFile(this.file);
      const json = zlib.gunzipSync(gz).toString('utf8');
      const value: unknown = JSON.parse(json);
      return isSnapshotUsable(value, this.root, this.extVersion) ? value : null;
    } catch { return null; }
  }

  async write(snap: UsageSnapshot): Promise<void> {
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      await fs.promises.writeFile(tmp, zlib.gzipSync(Buffer.from(JSON.stringify(snap), 'utf8'), { level: 1 }));
      await fs.promises.rename(tmp, this.file);
    } catch (err) {
      console.error('CSMS Code: 사용처 색인 캐시를 쓰지 못했습니다.', err);
      try { await fs.promises.unlink(tmp); } catch { /* 없으면 무시 */ }
    }
  }
}
```

- [ ] **Step 4: GREEN + 커밋** — `feat(infra): 사용처 색인 캐시 파일 I/O(gzip·원자적 쓰기)`

---

### Task 5: 백그라운드 검증

**Files:**
- Modify: `src/infrastructure/usage/php-usage-index.ts`
- Test: `test/unit/infra/php-usage-index.test.ts`

**Interfaces (Produces):** `revalidateFromRoot(root: string): Promise<boolean>`

- [ ] **Step 1: 실패하는 테스트**

```ts
describe('PhpUsageIndex — 백그라운드 검증', () => {
  let tmp: string;
  const write = (name: string, body: string) => fs.writeFileSync(join(tmp, name), body);
  beforeEach(async () => {
    tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-usage-reval-'));
    write('a.php', "<?php\nget_string('k1', 'local_x');\n");
    write('b.php', "<?php\nget_string('k2', 'local_x');\n");
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('바뀐 것이 없으면 false', async () => {
    const idx = new PhpUsageIndex(() => true);
    await idx.buildFromRoot(tmp);
    assert.equal(await idx.revalidateFromRoot(tmp), false);
  });
  it('수정·추가·삭제를 반영한다', async () => {
    const idx = new PhpUsageIndex(() => true);
    await idx.buildFromRoot(tmp);
    write('a.php', "<?php\nget_string('k1b', 'local_x');\n");   // 수정
    write('c.php', "<?php\nget_string('k3', 'local_x');\n");    // 추가
    fs.unlinkSync(join(tmp, 'b.php'));                          // 삭제
    assert.equal(await idx.revalidateFromRoot(tmp), true);
    assert.equal(idx.referencesOf('local_x', 'k1').length, 0);
    assert.equal(idx.referencesOf('local_x', 'k1b').length, 1);
    assert.equal(idx.referencesOf('local_x', 'k3').length, 1);
    assert.equal(idx.referencesOf('local_x', 'k2').length, 0, '삭제된 파일의 항목은 사라진다');
  });
  it('스탬프 없이 갱신된 파일은 다시 읽힌다(내용이 디스크와 다르면 되돌아온다)', async () => {
    const idx = new PhpUsageIndex(() => true);
    await idx.buildFromRoot(tmp);
    idx.updateFileText(join(tmp, 'a.php'), '<?php\n');           // 메모리만 비움(저장 증분 흉내)
    assert.equal(idx.referencesOf('local_x', 'k1').length, 0);
    assert.equal(await idx.revalidateFromRoot(tmp), true);
    assert.equal(idx.referencesOf('local_x', 'k1').length, 1, '디스크 내용으로 복구');
  });
});
```

- [ ] **Step 2: RED 확인.**

- [ ] **Step 3: 구현**

```ts
  /** 캐시로 채운 색인을 디스크와 맞춘다 — 빠른 순회 + 병렬 stat로 도장을 비교하고 바뀐 파일만 다시 읽는다.
   *  바뀐 것이 있으면 true(호출자가 화면을 다시 그린다). */
  async revalidateFromRoot(root: string): Promise<boolean> {
    const files = await listSourceFiles(root);
    const current = await statAll(files, root);
    const cached = this.trackedFiles().filter(f => insideRoot(root, f)).map(f => {
      const s = this.stamps.get(f);
      return [path.relative(root, f), s?.mtimeMs ?? 0, s?.size ?? -1] as StampRow;
    });
    const { changed, removed } = diffStamps(cached, current);
    for (const rel of removed) this.updateFileText(path.join(root, rel), '');
    for (let i = 0; i < changed.length; i += READ_CHUNK) {
      const chunk = changed.slice(i, i + READ_CHUNK).map(rel => path.join(root, rel));
      const read = await Promise.all(chunk.map(readWithStamp));
      for (const r of read) if (r) this.updateFileText(r.file, r.text, r.stamp);
      await new Promise<void>(r => setImmediate(r));
    }
    return changed.length > 0 || removed.length > 0;
  }
```
파일 하단 헬퍼:
```ts
/** 파일 도장을 병렬로 모은다 — 읽지 않으므로 검증은 스캔보다 훨씬 싸다. */
async function statAll(files: readonly string[], root: string): Promise<StampRow[]> {
  const out: StampRow[] = [];
  for (let i = 0; i < files.length; i += STAT_CHUNK) {
    const chunk = files.slice(i, i + STAT_CHUNK);
    const rows = await Promise.all(chunk.map(async f => {
      try { const s = await fs.promises.stat(f); return [path.relative(root, f), s.mtimeMs, s.size] as StampRow; }
      catch { return null; }
    }));
    for (const r of rows) if (r) out.push(r);
    await new Promise<void>(r => setImmediate(r));
  }
  return out;
}
```

- [ ] **Step 4: GREEN + 커밋** — `feat(infra): 사용처 색인 백그라운드 검증(도장 비교 + 변경분만 재적용)`

---

### Task 6: 결선·설정·문서·0.20.0

**Files:**
- Modify: `src/extension.ts`, `package.json`, `README.md`, `CHANGELOG.md`, `docs/PHASE2-BACKLOG.md`, `docs/manual-verification.md`

- [ ] **Step 1: 결선** — `extension.ts`

`usageIndex` 선언 근처(캐시는 컴포지션 루트가 만든다):
```ts
  const usageCache = new UsageIndexCache(ctx.globalStorageUri.fsPath, root,
    String((ctx.extension.packageJSON as { version?: string }).version ?? '0'));
  const usageCacheEnabled = () => vscode.workspace.getConfiguration('csmscode').get<boolean>('usageIndex.cache', true);
  const writeUsageCache = () => { if (usageCacheEnabled()) void usageCache.write(usageIndex.toSnapshot(root, String((ctx.extension.packageJSON as { version?: string }).version ?? '0'))); };
```
`usageHandle.build` 교체:
```ts
  const usageHandle: UsageIndexHandle = {
    built: () => usageIndex.isBuilt,
    build: cb => usageBuild ??= (async () => {
      const snap = usageCacheEnabled() ? await usageCache.read() : null;
      if (snap) {
        // 캐시 히트는 조용히 즉시 — 진행률 알림은 전체 스캔에만 뜬다
        usageIndex.loadSnapshot(snap, root);
        refreshLenses();
        void (async () => {
          if (await usageIndex.revalidateFromRoot(root)) { refreshLenses(); highlight.refreshAll(); }
          writeUsageCache();
        })();
        return;
      }
      await usageIndex.buildFromRoot(root, cb);
      refreshLenses();
      writeUsageCache();
    })(),
  };
```
주의: `highlight`는 아래에서 선언되므로 클로저 안에서만 참조한다(현재 코드도 같은 방식). `refreshLenses`·`lenses`는 이미 위에 있다.

저장·삭제 증분 뒤 캐시 다시 쓰기(디바운스) — 기존 `refreshDebouncer`를 재사용:
```ts
      usageIndex.updateFileText(d.uri.fsPath, d.getText());
      refreshLenses();
      refreshDebouncer.schedule('usagecache', writeUsageCache);
```
`onDidDeleteFiles`에도 같은 한 줄. (디바운서는 200ms — 쓰기가 45ms라 충분하다.)

`package.json`:
```json
"csmscode.usageIndex.cache": {
  "type": "boolean", "default": true,
  "description": "사용처 색인을 디스크에 저장해 다음에 즉시 불러옵니다(워크스페이스당 약 1MB). 불러온 뒤 백그라운드에서 바뀐 파일만 다시 읽습니다. 끄면 매번 전체 스캔합니다."
}
```
버전 `0.20.0`.

- [ ] **Step 2: 검증** — `npm run compile`·`npm run lint`·`npm run test:unit`·`npx tsc -p tsconfig.test.json`.

- [ ] **Step 3: 문서**
  - README: 기능 설명에 "사용처 색인은 첫 요청에 만들고 디스크에 캐시해 다음부터 즉시 불러옵니다" + 설정 표 한 줄 + 알려진 제한("캐시를 불러온 직후 잠깐은 마지막 세션 기준이고, 백그라운드 검증이 끝나면 맞춰집니다").
  - CHANGELOG `## [0.20.0] — 2026-08-31`: 순회·읽기 병렬화 실측(전/후), 캐시 동작·설정, 제한.
  - 백로그: 후속 후보로 "캐시 파일 수명 관리(워크스페이스당 1MB가 쌓인다)", "사용처 색인 메모리 다이어트(항목 55,568건에 100MB)".
  - 수동 검증: 첫 클릭 시간, 창을 닫고 다시 열었을 때 즉시, 외부에서 파일을 고친 뒤(git checkout) 몇 초 안에 반영, 설정을 끄면 매번 스캔.

- [ ] **Step 4: 패키지·설치·커밋**
```bash
npm run package
~/.vscode-server/bin/*/bin/code-server --install-extension "$PWD/csms-code-0.20.0.vsix" --force
```
커밋: `feat: 사용처 색인 디스크 캐시 + 병렬 스캔 (0.20.0)`

---

## Self-Review

- **스펙 커버리지**: §3.1 → Task 1, §3.2 스탬프 → Task 1·3, §3.3 → Task 2, §3.4 → Task 4, §3.5 → Task 3·5, §3.6 → Task 6, §4 침묵 규칙 → Task 4(read/write)·Task 6(분기), §5 테스트 → 각 Task, §6 → Task 6.
- **플레이스홀더**: 없음. 모든 코드 블록이 실제 삽입 내용이다.
- **타입 일관성**: `StampRow`(Task 2) ↔ `toSnapshot`·`revalidateFromRoot`(Task 3·5), `Extracted`(기존 타입) ↔ `applyExtracted`(Task 3), `FileStamp`(Task 1) ↔ `stamps` 맵(Task 1·3·5), `UsageIndexCache(dir, root, extVersion)`(Task 4) ↔ 결선(Task 6) 일치.
- **위험**: 병렬 순회가 결과 순서를 바꾸면 기존 위치 테스트가 깨진다 — 그래서 읽기 적용을 파일 순서로 고정했다. `out.push`는 순회 순서에 따라 달라질 수 있으므로, 순서 민감 테스트가 깨지면 `listSourceFiles` 결과를 정렬(`out.sort()`)해 안정화한다(정렬 비용은 24,717개에 수 ms).
