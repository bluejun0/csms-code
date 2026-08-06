# 색인 성능 최적화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 활성화 시 확장 호스트를 막는 동기 색인(콜드 ~1,730ms)을 비동기화하고, 파일 하나 변경에 전체를 다시 읽는 워처를 파일 단위 증분으로 바꾼다(lang 저장 실측 122ms → 한 자릿수 ms).

**Architecture:** 열거(741ms)와 읽기 모두 `fs.promises` + 200항목마다 `setImmediate` 양보로 비동기화한다. 동기·비동기 두 경로가 갈라지지 않도록 "파일 → 색인 구조" 조립을 한 함수로 뽑아 두 경로가 그것만 호출하고, 픽스처에서 두 경로가 같은 결과를 내는지 등가성 테스트로 고정한다. 워처는 경로 역산으로 메타를 구해 파일 단위로 갱신하고, 역산이 실패하면 전체 재빌드로 폴백한다. (주: 착수 시점 설계였던 "역산 실패 시 전체 재빌드 폴백"은 Task 5 리뷰에서 무용함이 증명되어 제거됐다 — 현행 동작은 스펙 §3.5가 권위다.)

**Tech Stack:** TypeScript (strict), `fs.promises`, mocha + ts-node.

**Spec:** `docs/superpowers/specs/2026-08-05-indexing-performance-design.md`

## Global Constraints

- **동기 `buildFromRoot`는 삭제하지 않는다** — 기존 테스트 다수가 모듈 로드 시 동기 호출한다. 비동기 형제를 추가하고 조립 로직을 공유한다.
- 비동기 루프는 200항목마다 `setImmediate` 양보(사용처 색인과 동일 관례). 진행률 콜백은 vscode 무관(테스트 가능).
- 빌드는 **완성된 맵을 만든 뒤 마지막에 교체** — 빌드 중 조회가 부분 결과를 보지 않는다.
- 색인 클래스는 `root`를 증분 API 인자로 받지 않는다 — 경로 역산은 호출부(extension.ts)가 하고 색인엔 메타를 넘긴다(기존 `IndexStore.updateFile(file, component)` 관례).
- 유닛: `npm run test:unit`. 커밋: `feat|fix|docs(scope): 한국어 요약`.

---

### Task 1: 비동기 파일 열거 3종

**Files:**
- Modify: `src/infrastructure/workspace/moodle-root-resolver.ts`
- Test: `test/unit/infra/resolver.test.ts`

**Interfaces:**
- Consumes: 기존 `PLUGIN_DIRS`·`pluginTypeOfRel`·`componentOfTemplateFile`·`LANG_LOCALES`.
- Produces (Task 2·3·4가 소비):
```ts
export async function listInstallXmlFilesAsync(root: string): Promise<{ file: string; component: string }[]>
export async function listLangFilesAsync(root: string): Promise<LangFileRef[]>
export async function listTemplateFilesAsync(root: string): Promise<TemplateFileRef[]>
export async function yieldNow(): Promise<void>   // setImmediate 래퍼 — 색인들이 재사용
export const INDEX_YIELD_EVERY = 200;
```

- [ ] **Step 1: 실패하는 테스트 작성**

`test/unit/infra/resolver.test.ts` — import에 세 async 함수를 추가하고 파일 끝에 describe 추가:
```ts
describe('MoodleRootResolver — 비동기 열거는 동기와 동일 결과', () => {
  const norm = (xs: { file: string }[]) => xs.map(x => x.file).sort();

  it('listInstallXmlFilesAsync ≡ listInstallXmlFiles', async () => {
    assert.deepEqual(norm(await listInstallXmlFilesAsync(root)), norm(listInstallXmlFiles(root)));
  });
  it('listLangFilesAsync ≡ listLangFiles (component·locale 포함)', async () => {
    const key = (xs: LangFileRef[]) => xs.map(x => `${x.component}:${x.locale}:${x.file}`).sort();
    assert.deepEqual(key(await listLangFilesAsync(root)), key(listLangFiles(root)));
  });
  it('listTemplateFilesAsync ≡ listTemplateFiles (component·name 포함)', async () => {
    const key = (xs: TemplateFileRef[]) => xs.map(x => `${x.component}/${x.name}:${x.file}`).sort();
    assert.deepEqual(key(await listTemplateFilesAsync(root)), key(listTemplateFiles(root)));
  });
});
```
그리고 파일 상단 import에 타입도 추가한다(같은 모듈에서):
```ts
import { LangFileRef, TemplateFileRef, listInstallXmlFilesAsync, listLangFilesAsync, listTemplateFilesAsync } from '../../../src/infrastructure/workspace/moodle-root-resolver';
```
(기존 import 줄에 이름을 덧붙이는 형태로도 무방하다.)

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx mocha test/unit/infra/resolver.test.ts`
Expected: FAIL — async 함수·타입 미export로 파일 로드 실패.

- [ ] **Step 3: 구현**

`src/infrastructure/workspace/moodle-root-resolver.ts` 파일 끝에 추가:
```ts
export const INDEX_YIELD_EVERY = 200;

/** 이벤트 루프 양보 — 색인 루프가 확장 호스트를 막지 않게 한다. */
export function yieldNow(): Promise<void> {
  return new Promise<void>(r => setImmediate(r));
}

async function existsAsync(p: string): Promise<boolean> {
  try { await fs.promises.access(p); return true; } catch { return false; }
}

/** 디렉터리(심볼릭 링크 대상이 디렉터리인 것 포함) 이름 목록 */
async function safeReaddirAsync(dir: string): Promise<string[]> {
  let entries: fs.Dirent[];
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return []; }
  const out: string[] = [];
  for (const d of entries) {
    if (d.isDirectory()) { out.push(d.name); continue; }
    if (!d.isSymbolicLink()) continue;
    try { if ((await fs.promises.stat(path.join(dir, d.name))).isDirectory()) out.push(d.name); } catch { /* 깨진 링크 무시 */ }
  }
  return out;
}

async function safeReaddirFilesAsync(dir: string): Promise<string[]> {
  try {
    return (await fs.promises.readdir(dir, { withFileTypes: true })).filter(d => d.isFile()).map(d => d.name);
  } catch { return []; }
}

/** listInstallXmlFiles의 비동기 판 — 규칙은 동일 함수(pluginTypeOfRel 계열)를 쓰므로 갈라질 수 없다. */
export async function listInstallXmlFilesAsync(root: string): Promise<{ file: string; component: string }[]> {
  const out: { file: string; component: string }[] = [];
  const core = path.join(root, 'lib', 'db', 'install.xml');
  if (await existsAsync(core)) out.push({ file: core, component: 'core' });
  let n = 0;
  for (const [type, relDir] of Object.entries(PLUGIN_DIRS)) {
    const typeDir = path.join(root, relDir);
    if (!await existsAsync(typeDir)) continue;
    for (const name of await safeReaddirAsync(typeDir)) {
      const f = path.join(typeDir, name, 'db', 'install.xml');
      if (await existsAsync(f)) out.push({ file: f, component: `${type}_${name}` });
      if (++n % INDEX_YIELD_EVERY === 0) await yieldNow();
    }
  }
  return out;
}

/** listLangFiles의 비동기 판 */
export async function listLangFilesAsync(root: string): Promise<LangFileRef[]> {
  const out: LangFileRef[] = [];
  const coreDir = path.join(root, 'lang', 'en');
  for (const f of await safeReaddirFilesAsync(coreDir)) {
    if (!f.endsWith('.php')) continue;
    const base = f.slice(0, -4);
    out.push({ file: path.join(coreDir, f), component: base === 'moodle' ? 'core' : `core_${base}`, locale: 'en' });
  }
  let n = 0;
  for (const [type, relDir] of Object.entries(PLUGIN_DIRS)) {
    const typeDir = path.join(root, relDir);
    if (!await existsAsync(typeDir)) continue;
    for (const name of await safeReaddirAsync(typeDir)) {
      const expected = type === 'mod' ? `${name}.php` : `${type}_${name}.php`;
      for (const locale of LANG_LOCALES) {
        const f = path.join(typeDir, name, 'lang', locale, expected);
        if (await existsAsync(f)) out.push({ file: f, component: `${type}_${name}`, locale });
      }
      if (++n % INDEX_YIELD_EVERY === 0) await yieldNow();
    }
  }
  return out;
}

/** listTemplateFiles의 비동기 판 — realpath 순환 가드도 동일하게 유지 */
export async function listTemplateFilesAsync(root: string): Promise<TemplateFileRef[]> {
  const out: TemplateFileRef[] = [];
  const seen = new Set<string>();
  let n = 0;
  const push = (file: string) => {
    const ref = componentOfTemplateFile(root, file);
    if (ref) out.push({ file, component: ref.component, name: ref.name });
  };
  const walk = async (dir: string): Promise<void> => {
    let real: string;
    try { real = await fs.promises.realpath(dir); } catch { return; }
    if (seen.has(real)) return;
    seen.add(real);
    for (const f of await safeReaddirFilesAsync(dir)) {
      if (f.endsWith('.mustache')) push(path.join(dir, f));
      if (++n % INDEX_YIELD_EVERY === 0) await yieldNow();
    }
    for (const d of await safeReaddirAsync(dir)) await walk(path.join(dir, d));
  };
  const coreDir = path.join(root, 'lib', 'templates');
  if (await existsAsync(coreDir)) await walk(coreDir);
  for (const relDir of Object.values(PLUGIN_DIRS)) {
    const typeDir = path.join(root, relDir);
    if (!await existsAsync(typeDir)) continue;
    for (const name of await safeReaddirAsync(typeDir)) {
      const tdir = path.join(typeDir, name, 'templates');
      if (await existsAsync(tdir)) await walk(tdir);
    }
  }
  return out;
}
```

- [ ] **Step 4: 테스트 통과 + 회귀 확인**

Run: `npx mocha test/unit/infra/resolver.test.ts && npm run test:unit && npx tsc -noEmit && npm run lint`
Expected: 신규 3건 녹색 — 186건(183+3).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/workspace/moodle-root-resolver.ts test/unit/infra/resolver.test.ts
git commit -m "feat(infra): 파일 열거 비동기 판 3종 — 활성화 블로킹 제거 준비"
```

---

### Task 2: IndexStore 비동기 빌드 + 증분 결선

**Files:**
- Modify: `src/infrastructure/indexing/index-store.ts`
- Modify: `src/infrastructure/workspace/moodle-root-resolver.ts` (`componentOfInstallXmlFile` 추가)
- Test: `test/unit/infra/index-store.test.ts`, `test/unit/infra/resolver.test.ts`

**Interfaces:**
- Consumes: Task 1 `listInstallXmlFilesAsync`·`yieldNow`·`INDEX_YIELD_EVERY`, 기존 `parseInstallXml`·`InMemoryTableRepository`.
- Produces (Task 5가 소비):
```ts
IndexStore.buildFromRootAsync(root: string, onProgress?: (done: number, total: number) => void): Promise<void>
IndexStore.updateFile(file: string, component: string): void   // 기존 — 결선만
IndexStore.removeFile(uri: string): void                       // 기존 — 결선만
export function componentOfInstallXmlFile(root: string, file: string): string | null
```

- [ ] **Step 1: 실패하는 테스트 작성**

`test/unit/infra/resolver.test.ts`에 describe 추가(import에 `componentOfInstallXmlFile` 추가):
```ts
describe('MoodleRootResolver — componentOfInstallXmlFile', () => {
  it('코어', () =>
    assert.equal(componentOfInstallXmlFile(root, join(root, 'lib/db/install.xml')), 'core'));
  it('플러그인', () =>
    assert.equal(componentOfInstallXmlFile(root, join(root, 'local/ubattend/db/install.xml')), 'local_ubattend'));
  it('blocks 디렉터리(타입명 block)', () =>
    assert.equal(componentOfInstallXmlFile(root, join(root, 'blocks/testblock/db/install.xml')), 'block_testblock'));
  it('규칙 밖 → null', () => {
    assert.equal(componentOfInstallXmlFile(root, join(root, 'local/ubattend/db/other.xml')), null);
    assert.equal(componentOfInstallXmlFile(root, '/etc/install.xml'), null);
  });
});
```

`test/unit/infra/index-store.test.ts` 파일 끝에 describe 추가:
```ts
describe('IndexStore — 비동기 빌드·증분', () => {
  it('async 빌드가 sync와 동일 결과', async () => {
    const a = new IndexStore(); a.buildFromRoot(root);
    const b = new IndexStore(); await b.buildFromRootAsync(root);
    assert.deepEqual(b.allTableNames().sort(), a.allTableNames().sort());
  });
  it('진행률 콜백이 최소 1회 호출되고 done ≤ total', async () => {
    const s = new IndexStore();
    const calls: [number, number][] = [];
    await s.buildFromRootAsync(root, (d, t) => calls.push([d, t]));
    assert.ok(calls.length >= 1);
    assert.ok(calls.every(([d, t]) => d <= t));
  });
  it('removeFile 후 그 파일의 테이블만 사라진다', async () => {
    const s = new IndexStore(); await s.buildFromRootAsync(root);
    assert.ok(s.getTable('local_ubattend_config'), '사전 조건');
    s.removeFile(join(root, 'local/ubattend/db/install.xml'));
    assert.equal(s.getTable('local_ubattend_config'), undefined);
    assert.ok(s.getTable('block_testblock'), '다른 파일의 테이블은 남는다');
  });
  it('증분(remove→update)이 전체 재빌드와 같은 상태로 수렴', async () => {
    const s = new IndexStore(); await s.buildFromRootAsync(root);
    const file = join(root, 'local/ubattend/db/install.xml');
    s.removeFile(file);
    s.updateFile(file, 'local_ubattend');
    const full = new IndexStore(); await full.buildFromRootAsync(root);
    assert.deepEqual(s.allTableNames().sort(), full.allTableNames().sort());
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx mocha test/unit/infra/index-store.test.ts test/unit/infra/resolver.test.ts`
Expected: FAIL — `componentOfInstallXmlFile`·`buildFromRootAsync` 미존재.

- [ ] **Step 3: 구현**

`src/infrastructure/workspace/moodle-root-resolver.ts`에 추가(다른 역산 함수들 옆):
```ts
/** install.xml 경로 → component (listInstallXmlFiles 규칙의 역함수). 규칙 밖은 null. */
export function componentOfInstallXmlFile(root: string, file: string): string | null {
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (parts.length === 3 && parts[0] === 'lib' && parts[1] === 'db' && parts[2] === 'install.xml') return 'core';
  const hit = pluginTypeOfRel(rel);
  if (!hit) return null;
  return hit.rest === 'db/install.xml' ? `${hit.type}_${hit.name}` : null;
}
```

`src/infrastructure/indexing/index-store.ts` 전체를 다음으로 교체:
```ts
import * as fs from 'fs';
import { Table } from '../../domain/moodle-model/table';
import { TableRepository } from '../../domain/moodle-model/ports/table-repository';
import { parseInstallXml, InMemoryTableRepository } from '../xmldb/xmldb-table-repository';
import { listInstallXmlFiles, listInstallXmlFilesAsync, yieldNow, INDEX_YIELD_EVERY } from '../workspace/moodle-root-resolver';

export class IndexStore implements TableRepository {
  private repo = new InMemoryTableRepository();

  buildFromRoot(root: string): void {
    const all: Table[] = [];
    for (const { file, component } of listInstallXmlFiles(root)) {
      all.push(...safeParse(file, component));
    }
    this.repo.replaceAll(all);
  }

  /** 활성화 경로용 — 열거·읽기 모두 비동기이고 200파일마다 이벤트 루프를 양보한다.
   *  완성된 목록을 만든 뒤 마지막에 교체하므로 빌드 중 조회가 부분 결과를 보지 않는다. */
  async buildFromRootAsync(root: string, onProgress?: (done: number, total: number) => void): Promise<void> {
    const refs = await listInstallXmlFilesAsync(root);
    const all: Table[] = [];
    let done = 0;
    for (const { file, component } of refs) {
      all.push(...await safeParseAsync(file, component));
      done++;
      if (done % INDEX_YIELD_EVERY === 0) { onProgress?.(done, refs.length); await yieldNow(); }
    }
    onProgress?.(refs.length, refs.length);
    this.repo.replaceAll(all);
  }

  /** install.xml 하나가 바뀌면 그 파일의 테이블만 갱신 */
  updateFile(file: string, component: string): void {
    this.repo.removeByUri(file);
    this.repo.upsert(safeParse(file, component));
  }
  removeFile(uri: string): void { this.repo.removeByUri(uri); }

  getTable(name: string) { return this.repo.getTable(name); }
  allTableNames() { return this.repo.allTableNames(); }
}

function safeParse(file: string, component: string): Table[] {
  try { return parseInstallXml(fs.readFileSync(file, 'utf8'), file, component); }
  catch { return []; }
}

async function safeParseAsync(file: string, component: string): Promise<Table[]> {
  try { return parseInstallXml(await fs.promises.readFile(file, 'utf8'), file, component); }
  catch { return []; }
}
```
(조립은 두 경로 모두 `parseInstallXml` 하나만 쓴다 — 읽기 방식만 다르다.)

- [ ] **Step 4: 테스트 통과 + 회귀 확인**

Run: `npx mocha test/unit/infra/index-store.test.ts test/unit/infra/resolver.test.ts && npm run test:unit && npx tsc -noEmit`
Expected: 신규 8건 녹색 — 194건(186+8).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/indexing/index-store.ts src/infrastructure/workspace/moodle-root-resolver.ts test/unit/infra/index-store.test.ts test/unit/infra/resolver.test.ts
git commit -m "feat(infra): IndexStore 비동기 빌드 + install.xml 경로 역산(증분 결선 준비)"
```

---

### Task 3: StringIndexStore 비동기 빌드 + 증분

**Files:**
- Modify: `src/infrastructure/lang/string-index-store.ts`
- Modify: `src/infrastructure/workspace/moodle-root-resolver.ts` (`langFileMetaOf` 추가, `componentOfLangFile`을 그 위에 재정의)
- Test: `test/unit/infra/string-index.test.ts`, `test/unit/infra/resolver.test.ts`

**Interfaces:**
- Consumes: Task 1 `listLangFilesAsync`·`yieldNow`·`INDEX_YIELD_EVERY`, 기존 `parseLangFile`·`normalizeComponent`.
- Produces (Task 5가 소비):
```ts
StringIndexStore.buildFromRootAsync(root: string, onProgress?: (done: number, total: number) => void): Promise<void>
StringIndexStore.updateFile(file: string, component: string, locale: string): void
StringIndexStore.removeFile(uri: string): void
export function langFileMetaOf(root: string, file: string): { component: string; locale: string } | null
```

- [ ] **Step 1: 실패하는 테스트 작성**

`test/unit/infra/resolver.test.ts`에 describe 추가(import에 `langFileMetaOf` 추가):
```ts
describe('MoodleRootResolver — langFileMetaOf', () => {
  it('플러그인 ko', () =>
    assert.deepEqual(langFileMetaOf(root, join(root, 'local/ubattend/lang/ko/local_ubattend.php')),
      { component: 'local_ubattend', locale: 'ko' }));
  it('코어 en', () =>
    assert.deepEqual(langFileMetaOf(root, join(root, 'lang/en/moodle.php')), { component: 'core', locale: 'en' }));
  it('규칙 밖 → null', () =>
    assert.equal(langFileMetaOf(root, join(root, 'local/ubattend/lang/ko/wrong.php')), null));
});
```

`test/unit/infra/string-index.test.ts` 파일 끝에 describe 추가:
```ts
describe('StringIndexStore — 비동기 빌드·증분', () => {
  const ubKo = join(root, 'local/ubattend/lang/ko/local_ubattend.php');

  it('async 빌드가 sync와 동일 결과', async () => {
    const a = new StringIndexStore(); a.buildFromRoot(root);
    const b = new StringIndexStore(); await b.buildFromRootAsync(root);
    const dump = (s: StringIndexStore) => s.keysOf('local_ubattend')
      .map(x => `${x.key}|${x.ko?.value ?? ''}|${x.en?.value ?? ''}`).sort();
    assert.deepEqual(dump(b), dump(a));
    assert.equal(b.getString('core', 'ok')!.en!.value, a.getString('core', 'ok')!.en!.value);
  });
  it('진행률 콜백이 최소 1회 호출되고 done ≤ total', async () => {
    const s = new StringIndexStore();
    const calls: [number, number][] = [];
    await s.buildFromRootAsync(root, (d, t) => calls.push([d, t]));
    assert.ok(calls.length >= 1);
    assert.ok(calls.every(([d, t]) => d <= t));
  });
  it('removeFile: 해당 locale만 사라지고 en은 남는다', async () => {
    const s = new StringIndexStore(); await s.buildFromRootAsync(root);
    assert.ok(s.getString('local_ubattend', 'attendance_book')!.ko, '사전 조건: ko 존재');
    s.removeFile(ubKo);
    const after = s.getString('local_ubattend', 'attendance_book')!;
    assert.equal(after.ko, undefined, 'ko 제거');
    assert.ok(after.en, 'en은 유지');
  });
  it('removeFile: 두 locale 모두 사라진 키는 제거된다', async () => {
    const s = new StringIndexStore(); await s.buildFromRootAsync(root);
    s.removeFile(ubKo);
    s.removeFile(join(root, 'local/ubattend/lang/en/local_ubattend.php'));
    assert.equal(s.getString('local_ubattend', 'attendance_book'), undefined);
    assert.equal(s.hasComponent('local_ubattend'), false, '빈 컴포넌트 맵도 제거');
  });
  it('증분(update)이 전체 재빌드와 같은 상태로 수렴', async () => {
    const s = new StringIndexStore(); await s.buildFromRootAsync(root);
    s.removeFile(ubKo);
    s.updateFile(ubKo, 'local_ubattend', 'ko');
    const full = new StringIndexStore(); await full.buildFromRootAsync(root);
    const dump = (x: StringIndexStore) => x.keysOf('local_ubattend')
      .map(v => `${v.key}|${v.ko?.value ?? ''}|${v.en?.value ?? ''}`).sort();
    assert.deepEqual(dump(s), dump(full));
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx mocha test/unit/infra/string-index.test.ts test/unit/infra/resolver.test.ts`
Expected: FAIL — `langFileMetaOf`·`buildFromRootAsync`·`updateFile` 미존재.

- [ ] **Step 3: 역산 함수 추가**

`src/infrastructure/workspace/moodle-root-resolver.ts`의 기존 `componentOfLangFile` 함수 전체를 다음 두 함수로 교체(규칙은 동일, locale까지 반환하도록 일반화하고 기존 함수는 그 위에 얹는다):
```ts
/** lang 파일 경로 → { component, locale }. 규칙 밖은 null. */
export function langFileMetaOf(root: string, file: string): { component: string; locale: string } | null {
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (parts.length === 3 && parts[0] === 'lang' && parts[1] === 'en' && parts[2].endsWith('.php')) {
    const base = parts[2].slice(0, -4);
    return { component: base === 'moodle' ? 'core' : `core_${base}`, locale: 'en' };
  }
  const hit = pluginTypeOfRel(rel);
  if (!hit) return null;
  const restParts = hit.rest.split('/');
  if (restParts.length !== 3 || restParts[0] !== 'lang' || !LANG_LOCALES.includes(restParts[1])) return null;
  const expected = hit.type === 'mod' ? `${hit.name}.php` : `${hit.type}_${hit.name}.php`;
  return restParts[2] === expected ? { component: `${hit.type}_${hit.name}`, locale: restParts[1] } : null;
}

/** lang 파일 경로 → component (규칙 밖은 null) */
export function componentOfLangFile(root: string, file: string): string | null {
  return langFileMetaOf(root, file)?.component ?? null;
}
```

- [ ] **Step 4: 색인 구현**

`src/infrastructure/lang/string-index-store.ts` 전체를 다음으로 교체:
```ts
import * as fs from 'fs';
import { LangEntry, LangString } from '../../domain/lang-model/lang-string';
import { StringRepository } from '../../domain/lang-model/ports/string-repository';
import { parseLangFile } from './lang-file-parser';
import { listLangFiles, listLangFilesAsync, yieldNow, INDEX_YIELD_EVERY } from '../workspace/moodle-root-resolver';
import { normalizeComponent } from '../../domain/lang-model/services/component-normalizer';

type CompMap = Map<string, Map<string, LangString>>;

export class StringIndexStore implements StringRepository {
  private byComponent: CompMap = new Map();

  buildFromRoot(root: string): void {
    const map: CompMap = new Map();
    for (const { file, component, locale } of listLangFiles(root)) {
      mergeInto(map, file, component, locale, safeReadSync(file));
    }
    this.byComponent = map;
  }

  /** 활성화 경로용 — 열거·읽기 모두 비동기, 200파일마다 양보. 완성 후 마지막에 교체한다. */
  async buildFromRootAsync(root: string, onProgress?: (done: number, total: number) => void): Promise<void> {
    const refs = await listLangFilesAsync(root);
    const map: CompMap = new Map();
    let done = 0;
    for (const { file, component, locale } of refs) {
      mergeInto(map, file, component, locale, await safeReadAsync(file));
      done++;
      if (done % INDEX_YIELD_EVERY === 0) { onProgress?.(done, refs.length); await yieldNow(); }
    }
    onProgress?.(refs.length, refs.length);
    this.byComponent = map;
  }

  /** lang 파일 하나가 바뀌면 그 파일 항목만 교체 */
  updateFile(file: string, component: string, locale: string): void {
    this.removeFile(file);
    mergeInto(this.byComponent, file, component, locale, safeReadSync(file));
  }

  /** 해당 파일에서 온 항목 제거 — 두 locale 모두 사라진 키와 빈 컴포넌트 맵까지 정리한다
   *  (정규화가 byComponent.has()에 의존하므로 빈 맵을 남기면 bare 이름 해석이 틀어진다). */
  removeFile(uri: string): void {
    for (const [comp, keys] of this.byComponent) {
      for (const [key, ls] of keys) {
        if (ls.ko?.location.uri === uri) delete ls.ko;
        if (ls.en?.location.uri === uri) delete ls.en;
        if (!ls.ko && !ls.en) keys.delete(key);
      }
      if (keys.size === 0) this.byComponent.delete(comp);
    }
  }

  getString(component: string, key: string): LangString | undefined {
    return this.byComponent.get(this.normalize(component))?.get(key);
  }
  keysOf(component: string): LangString[] {
    const c = this.byComponent.get(this.normalize(component));
    return c ? [...c.values()] : [];
  }
  hasComponent(component: string): boolean { return this.byComponent.has(this.normalize(component)); }

  private normalize(raw: string): string {
    return normalizeComponent(raw, c => this.byComponent.has(c));
  }
}

/** 조립 단일 지점 — 동기·비동기·증분 세 경로가 모두 이 함수만 쓴다(결과가 갈라질 수 없다). */
function mergeInto(map: CompMap, file: string, component: string, locale: string, text: string): void {
  let comp = map.get(component);
  if (!comp) { comp = new Map(); map.set(component, comp); }
  for (const p of parseLangFileSafe(text)) {
    let entry = comp.get(p.key);
    if (!entry) { entry = { key: p.key }; comp.set(p.key, entry); }
    const e: LangEntry = { value: p.value, location: { uri: file, line: p.line, column: 0 } };
    if (locale === 'ko') entry.ko = e; else entry.en = e;
  }
  if (comp.size === 0) map.delete(component); // 빈 파일이 빈 컴포넌트 맵을 남기지 않게
}

function parseLangFileSafe(text: string) {
  try { return parseLangFile(text); } catch { return []; }
}
function safeReadSync(file: string): string {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}
async function safeReadAsync(file: string): Promise<string> {
  try { return await fs.promises.readFile(file, 'utf8'); } catch { return ''; }
}
```

- [ ] **Step 5: 테스트 통과 + 회귀 확인**

Run: `npx mocha test/unit/infra/string-index.test.ts test/unit/infra/resolver.test.ts && npm run test:unit && npx tsc -noEmit`
Expected: 신규 8건 녹색 — 202건(194+8). 기존 string-index 테스트(정규화·ko/en 병합)가 그대로 녹색이어야 한다(조립 추출 등가성).

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/lang/string-index-store.ts src/infrastructure/workspace/moodle-root-resolver.ts test/unit/infra/string-index.test.ts test/unit/infra/resolver.test.ts
git commit -m "feat(infra): StringIndexStore 비동기 빌드 + 파일 단위 증분(조립 단일화)"
```

---

### Task 4: TemplateIndex 비동기 빌드 + 증분

**Files:**
- Modify: `src/infrastructure/templates/template-index.ts`
- Test: `test/unit/infra/template-index.test.ts`

**Interfaces:**
- Consumes: Task 1 `listTemplateFilesAsync`·`yieldNow`·`INDEX_YIELD_EVERY`.
- Produces (Task 5가 소비):
```ts
TemplateIndex.buildFromRootAsync(root: string, onProgress?: (done: number, total: number) => void): Promise<void>
TemplateIndex.updateFile(file: string, component: string, name: string): void
TemplateIndex.removeFile(uri: string): void
```

- [ ] **Step 1: 실패하는 테스트 작성**

`test/unit/infra/template-index.test.ts` 파일 끝에 추가:
```ts
describe('TemplateIndex — 비동기 빌드·증분', () => {
  const override = join(root, 'theme/coursemos/templates/local_ubattend/setting.mustache');

  it('async 빌드가 sync와 동일 결과', async () => {
    const a = new TemplateIndex(); a.buildFromRoot(root);
    const b = new TemplateIndex(); await b.buildFromRootAsync(root);
    const dump = (s: TemplateIndex) => s.locationsOf('local_ubattend', 'setting').map(l => l.uri).sort();
    assert.deepEqual(dump(b), dump(a));
    assert.equal(b.has('core', 'core_tmpl'), a.has('core', 'core_tmpl'));
  });
  it('진행률 콜백이 최소 1회 호출되고 done ≤ total', async () => {
    const s = new TemplateIndex();
    const calls: [number, number][] = [];
    await s.buildFromRootAsync(root, (d, t) => calls.push([d, t]));
    assert.ok(calls.length >= 1);
    assert.ok(calls.every(([d, t]) => d <= t));
  });
  it('removeFile: 오버라이드만 제거하면 원본이 남는다', async () => {
    const s = new TemplateIndex(); await s.buildFromRootAsync(root);
    assert.equal(s.locationsOf('local_ubattend', 'setting').length, 2, '사전 조건');
    s.removeFile(override);
    const left = s.locationsOf('local_ubattend', 'setting');
    assert.equal(left.length, 1);
    assert.ok(left[0].uri.includes(join('local', 'ubattend', 'templates')));
  });
  it('removeFile: 마지막 위치가 사라지면 키도 사라진다', async () => {
    const s = new TemplateIndex(); await s.buildFromRootAsync(root);
    s.removeFile(join(root, 'lib/templates/core_tmpl.mustache'));
    assert.equal(s.has('core', 'core_tmpl'), false);
  });
  it('증분(update)이 전체 재빌드와 같은 상태로 수렴', async () => {
    const s = new TemplateIndex(); await s.buildFromRootAsync(root);
    s.removeFile(override);
    s.updateFile(override, 'local_ubattend', 'setting');
    const full = new TemplateIndex(); await full.buildFromRootAsync(root);
    assert.deepEqual(s.locationsOf('local_ubattend', 'setting').map(l => l.uri).sort(),
      full.locationsOf('local_ubattend', 'setting').map(l => l.uri).sort());
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx mocha test/unit/infra/template-index.test.ts`
Expected: FAIL — `buildFromRootAsync`·`updateFile`·`removeFile` 미존재.

- [ ] **Step 3: 구현**

`src/infrastructure/templates/template-index.ts` 전체를 다음으로 교체:
```ts
import { SourceLocation } from '../../domain/shared/value-objects';
import { TemplateRepository } from '../../domain/template-model/ports/template-repository';
import { listTemplateFiles, listTemplateFilesAsync, yieldNow, INDEX_YIELD_EVERY } from '../workspace/moodle-root-resolver';

type RefMap = Map<string, SourceLocation[]>;

/** `component/name` → 템플릿 파일 위치. 원본과 테마 오버라이드가 함께 잡히면 둘 다 보관한다. */
export class TemplateIndex implements TemplateRepository {
  private byRef: RefMap = new Map();

  buildFromRoot(root: string): void {
    const map: RefMap = new Map();
    for (const { file, component, name } of listTemplateFiles(root)) addRef(map, file, component, name);
    this.byRef = map;
  }

  /** 활성화 경로용 — 열거가 비동기이고 200항목마다 양보한다(템플릿은 내용을 읽지 않는다). */
  async buildFromRootAsync(root: string, onProgress?: (done: number, total: number) => void): Promise<void> {
    const refs = await listTemplateFilesAsync(root);
    const map: RefMap = new Map();
    let done = 0;
    for (const { file, component, name } of refs) {
      addRef(map, file, component, name);
      done++;
      if (done % INDEX_YIELD_EVERY === 0) { onProgress?.(done, refs.length); await yieldNow(); }
    }
    onProgress?.(refs.length, refs.length);
    this.byRef = map;
  }

  /** 템플릿 파일 하나가 바뀌면 그 위치만 교체 */
  updateFile(file: string, component: string, name: string): void {
    this.removeFile(file);
    addRef(this.byRef, file, component, name);
  }

  /** 해당 파일 위치만 제거 — 위치가 하나도 남지 않은 키는 지운다 */
  removeFile(uri: string): void {
    for (const [key, arr] of this.byRef) {
      const kept = arr.filter(l => l.uri !== uri);
      if (kept.length === arr.length) continue;
      if (kept.length === 0) this.byRef.delete(key); else this.byRef.set(key, kept);
    }
  }

  locationsOf(component: string, name: string): SourceLocation[] {
    return this.byRef.get(`${component}/${name}`) ?? [];
  }
  has(component: string, name: string): boolean { return this.byRef.has(`${component}/${name}`); }
}

/** 조립 단일 지점 — 동기·비동기·증분 세 경로가 모두 이 함수만 쓴다. */
function addRef(map: RefMap, file: string, component: string, name: string): void {
  const key = `${component}/${name}`;
  const arr = map.get(key);
  if (arr) arr.push({ uri: file, line: 0, column: 0 });
  else map.set(key, [{ uri: file, line: 0, column: 0 }]);
}
```

- [ ] **Step 4: 테스트 통과 + 회귀 확인**

Run: `npx mocha test/unit/infra/template-index.test.ts && npm run test:unit && npx tsc -noEmit`
Expected: 신규 5건 녹색 — 207건(202+5).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/templates/template-index.ts test/unit/infra/template-index.test.ts
git commit -m "feat(infra): TemplateIndex 비동기 빌드 + 파일 단위 증분"
```

---

### Task 5: 결선 — 비동기 활성화 + 증분 워처 + 갱신 훅

**Files:**
- Modify: `src/presentation/providers/record-diagnostics.ts` (`refreshAll` 반환)
- Modify: `src/presentation/resolved-highlight.ts` (`refreshAll` 반환)
- Modify: `src/extension.ts`

**Interfaces:**
- Consumes: Task 2·3·4의 `buildFromRootAsync`/`updateFile`/`removeFile`, Task 2·3의 `componentOfInstallXmlFile`·`langFileMetaOf`, 기존 `componentOfTemplateFile`.
- Produces:
```ts
registerDiagnostics(ctx, uc, ucStrings): { refreshAll(): void }
registerResolvedHighlight(ctx, sources): { refreshAll(): void }
```

- [ ] **Step 1: 갱신 훅 반환**

`src/presentation/providers/record-diagnostics.ts` — 함수 시그니처에 반환 타입을 추가하고 마지막에 훅을 돌려준다. 시그니처 줄을 다음으로 교체:
```ts
export function registerDiagnostics(ctx: vscode.ExtensionContext, uc: ValidateRecordColumns, ucStrings: ValidateStringKeys): { refreshAll(): void } {
```
그리고 함수 본문 **맨 끝**(기존 `ctx.subscriptions.push(...)` 블록 다음)에 추가:
```ts
  return { refreshAll: () => vscode.workspace.textDocuments.forEach(refresh) };
```

`src/presentation/resolved-highlight.ts` — 시그니처 줄을 다음으로 교체:
```ts
export function registerResolvedHighlight(ctx: vscode.ExtensionContext, sources: HighlightSource[]): { refreshAll(): void } {
```
그리고 함수 본문 맨 끝에 추가:
```ts
  return { refreshAll: () => vscode.window.visibleTextEditors.forEach(refresh) };
```

- [ ] **Step 2: extension.ts — 색인 비동기화**

1. import 줄 교체(역산 함수 두 개 추가):
```ts
import { findMoodleRoot, componentOfLangFile, componentOfTemplateFile, componentOfInstallXmlFile, langFileMetaOf } from './infrastructure/workspace/moodle-root-resolver';
```

2. 색인 3종 생성부(현재 `store.buildFromRoot(root);` 등 6줄)를 **생성만** 남기도록 교체:
```ts
  const store = new IndexStore();
  const strings = new StringIndexStore();
  const templates = new TemplateIndex();
```

3. `registerDiagnostics(...)`·`registerResolvedHighlight(...)` 호출을 반환값을 받도록 바꾸고, 그 뒤에 비동기 빌드를 붙인다. 기존 두 호출 줄을 다음으로 교체:
```ts
  const diagnostics = registerDiagnostics(ctx, validate, validateStr);
  const highlight = registerResolvedHighlight(ctx, [
    { setting: 'strings.highlightResolved', languages: ['php'], run: t => listResolved.run(t) },
    { setting: 'templates.highlightResolved', languages: ['php'], run: t => listResolvedTpl.run(t) },
    { setting: 'strings.highlightResolved', languages: ['javascript'], run: t => listResolvedJs.runStrings(t) },
    { setting: 'templates.highlightResolved', languages: ['javascript'], run: t => listResolvedJs.runTemplates(t) },
  ]);
  const refreshAll = () => { diagnostics.refreshAll(); highlight.refreshAll(); };

  // 색인은 비동기로 — 활성화가 확장 호스트를 막지 않는다(실측 콜드 ~1.7초).
  // 빌드 완료 전 조회는 빈 결과(침묵 원칙)이고, 완료 후 열린 문서를 한 번 갱신한다.
  // 알림이 아니라 상태바(Window) — 워크스페이스를 열 때마다 뜨는 알림은 소음이다.
  void vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'CSMS Code: 색인 중…' },
    async () => {
      await store.buildFromRootAsync(root);
      await strings.buildFromRootAsync(root);
      await templates.buildFromRootAsync(root);
      refreshAll();
    });
```

- [ ] **Step 3: extension.ts — 워처 증분화**

기존 워처 3블록(install.xml / lang / templates)을 다음으로 교체:
```ts
  // install.xml 변경 → 그 파일만 갱신. 역산 실패(규칙 밖)면 전체 재빌드로 폴백해 색인이 조용히 낡지 않게 한다.
  const watcher = vscode.workspace.createFileSystemWatcher('**/db/install.xml');
  const onXml = (uri: vscode.Uri, removed: boolean) => {
    const component = componentOfInstallXmlFile(root, uri.fsPath);
    if (!component) { void store.buildFromRootAsync(root).then(refreshAll); return; }
    if (removed) store.removeFile(uri.fsPath); else store.updateFile(uri.fsPath, component);
    refreshAll();
  };
  ctx.subscriptions.push(watcher,
    watcher.onDidChange(u => onXml(u, false)),
    watcher.onDidCreate(u => onXml(u, false)),
    watcher.onDidDelete(u => onXml(u, true)));

  // lang 파일 변경 → 그 파일만 갱신(실측 전체 재색인 122ms → ~1ms)
  const langWatcher = vscode.workspace.createFileSystemWatcher('**/lang/*/*.php');
  const onLang = (uri: vscode.Uri, removed: boolean) => {
    const meta = langFileMetaOf(root, uri.fsPath);
    if (!meta) { void strings.buildFromRootAsync(root).then(refreshAll); return; }
    if (removed) strings.removeFile(uri.fsPath); else strings.updateFile(uri.fsPath, meta.component, meta.locale);
    refreshAll();
  };
  ctx.subscriptions.push(langWatcher,
    langWatcher.onDidChange(u => onLang(u, false)),
    langWatcher.onDidCreate(u => onLang(u, false)),
    langWatcher.onDidDelete(u => onLang(u, true)));

  // 템플릿 변경 → 그 파일만 갱신
  const tplWatcher = vscode.workspace.createFileSystemWatcher('**/templates/**/*.mustache');
  const onTpl = (uri: vscode.Uri, removed: boolean) => {
    const ref = componentOfTemplateFile(root, uri.fsPath);
    if (!ref) { void templates.buildFromRootAsync(root).then(refreshAll); return; }
    if (removed) templates.removeFile(uri.fsPath); else templates.updateFile(uri.fsPath, ref.component, ref.name);
    refreshAll();
  };
  ctx.subscriptions.push(tplWatcher,
    tplWatcher.onDidChange(u => onTpl(u, false)),
    tplWatcher.onDidCreate(u => onTpl(u, false)),
    tplWatcher.onDidDelete(u => onTpl(u, true)));
```

- [ ] **Step 4: 활성화 경로에 동기 I/O가 남지 않았는지 확인**

Run: `grep -n "buildFromRoot(" src/extension.ts`
Expected: 출력 없음(모두 `buildFromRootAsync`). `store.updateFile`은 파일 1개만 동기로 읽으므로 허용된다.

- [ ] **Step 5: 전체 검증**

Run: `npm run test:unit && npm run lint && npm run compile && npx tsc -p tsconfig.test.json`
Expected: 전부 통과 — 207건 유지(이 태스크는 유닛 테스트를 늘리지 않는다).

- [ ] **Step 6: Commit**

```bash
git add src/presentation/providers/record-diagnostics.ts src/presentation/resolved-highlight.ts src/extension.ts
git commit -m "perf(presentation): 활성화 색인 비동기화 + 워처 파일 단위 증분 결선"
```

---

### Task 6: 문서 갱신 + 최종 검증

**Files:**
- Modify: `docs/PHASE2-BACKLOG.md`, `docs/manual-verification.md`

**Interfaces:**
- Consumes: Task 1~5 완료 상태 (코드 변경 없음).
- Produces: 갱신된 문서.

- [ ] **Step 1: 백로그 5번 완료 표시**

`docs/PHASE2-BACKLOG.md`의 5번 항목 한 줄을 다음으로 교체:
```markdown
5. ~~**비동기 활성화 색인**~~ — ✅ 완료 (2026-08-05, 설계: `docs/superpowers/specs/2026-08-05-indexing-performance-design.md`). 열거·읽기 모두 `fs.promises` + 200항목마다 양보, 상태바 진행률. 실측 활성화 블로킹 콜드 ~1,730ms → 0(비동기). 워처도 전체 재색인에서 파일 단위 증분으로(lang 저장 122ms → ~1ms).
```

- [ ] **Step 2: 백로그 7번 문구 갱신(일부 해소)**

`docs/PHASE2-BACKLOG.md`의 7번 항목 한 줄을 다음으로 교체:
```markdown
7. **dead code 정리 또는 결선**: `parseFrankenstyle`, `TableRepository.allTableNames()`, `RecordAssignment.receiver`. (`IndexStore.updateFile/removeFile`은 2026-08-05 증분 워처에 결선되어 해소됨.)
```

- [ ] **Step 3: 수동 검증 항목 추가**

`docs/manual-verification.md`의 마지막 번호 항목 다음에 추가(현재 21번이면 22~24번):
```markdown
22. 워크스페이스를 처음 열 때 편집이 멈추지 않고, 상태바에 "CSMS Code: 색인 중…"이 잠깐 보인 뒤 사라짐(색인 완료 후 진단·하이라이트가 자동으로 채워짐)
23. lang 파일의 값을 고쳐 저장 → hover/완성에 즉시 반영되고 저장이 체감상 멈추지 않음(전체 재색인이 아니라 그 파일만 갱신)
24. install.xml에 FIELD를 추가해 저장 → 해당 테이블 컬럼 완성에 즉시 반영. .mustache 파일을 새로 만들면 그 참조가 바로 해석됨(하이라이트 색이 붙음)
```

- [ ] **Step 4: 최종 전체 검증**

Run: `npm run test:unit && npm run lint && npm run compile && npx tsc -p tsconfig.test.json`
Expected: 전부 통과 — 유닛 207건(183 기존 + 24 신규), eslint, 번들, 테스트 컴파일.

- [ ] **Step 5: Commit**

```bash
git add docs/PHASE2-BACKLOG.md docs/manual-verification.md
git commit -m "docs: 색인 성능 최적화 반영 — 백로그 5번 완료·7번 일부 해소"
```
