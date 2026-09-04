import * as fs from 'fs';
import * as path from 'path';
import { SourceLocation } from '../../domain/shared/value-objects';
import { StringUsageRepository } from '../../domain/lang-model/ports/string-usage-repository';
import { TemplateUsageRepository } from '../../domain/template-model/ports/template-usage-repository';
import { AmdUsageRepository } from '../../domain/amd-model/ports/amd-usage-repository';
import { ConfigUsageRepository } from '../../domain/moodle-model/ports/config-usage-repository';
import { TableUsageRepository } from '../../domain/moodle-model/ports/table-usage-repository';
import { configKeyId } from '../../domain/moodle-model/services/config-plugin';
import { SNAPSHOT_VERSION, StampRow, UsageSnapshot, diffStamps, packRows, unpackRows } from './usage-snapshot';
import { StringId, StringPool } from './string-pool';
import { ConfigUsage, RefUsage, StringUsage, TableUsage, UsageExtract, emptyExtract } from './usage-entries';
import { SKIP_DIRS, isIndexableSourcePath, extractUsages } from './extract-usages';

export { isIndexableSourcePath } from './extract-usages';

const YIELD_EVERY = 200;
const READ_CHUNK = 16;   // 읽기 동시 수 — 순차 대비 4배가량, 8~32 구간에서 평탄하다
const STAT_CHUNK = 64;   // stat은 읽기보다 싸다

/** 캐시 검증용 파일 도장 — 내용을 다시 읽지 않고 mtime·size로 판정한다. */
export interface FileStamp { mtimeMs: number; size: number; }

/** 열거 결과. `failures`는 읽지 못한 디렉터리 수 — 0이 아니면 "파일이 사라졌다"고 단정할 수 없다. */
interface Scan { files: string[]; failures: number }

/** 문자열·템플릿·AMD·설정·테이블 사용처의 워크스페이스 색인 — PHP·JS·mustache를 한 번의 스캔에서 함께 훑는다.
 *  lazy 빌드 + 저장/삭제 시 파일 단위 증분. 문자열은 모두 pool을 지나 id로 보관한다 — 정규식 캡처
 *  조각이 그대로 붙잡혀 파일 전체를 물고 늘어지는 일이 타입 수준에서 불가능해진다. */
export class PhpUsageIndex implements StringUsageRepository, TemplateUsageRepository, AmdUsageRepository, ConfigUsageRepository, TableUsageRepository {
  private pool = new StringPool();
  private byFile = new Map<StringId, UsageExtract>();
  private byComponentKey = new Map<StringId, Map<StringId, StringUsage[]>>();
  private byTemplateRef = new Map<StringId, RefUsage[]>();
  private byAmdRef = new Map<StringId, RefUsage[]>();
  private byConfigId = new Map<StringId, ConfigUsage[]>();
  private byTableName = new Map<StringId, TableUsage[]>();
  private stamps = new Map<StringId, FileStamp>();
  private builtFlag = false;

  constructor(private hasCanonical: (c: string) => boolean) {}

  get isBuilt(): boolean { return this.builtFlag; }

  async buildFromRoot(root: string, onProgress?: (done: number, total: number) => void): Promise<void> {
    const { files } = await listSourceFiles(root);
    this.reset(); // 전체 빌드는 빈 상태에서 시작한다 — 앞선 색인의 잔재가 남지 않게
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

  /** 파일 단위 증분: 기존 항목 제거 후 재추출 (저장 시 호출). 확장자별 추출은 extractUsages가 고른다.
   *  `stamp`를 주면 기록하고, 주지 않으면 그 파일 도장을 지운다 — 저장 시점에는 mtime을 모르므로
   *  다음 검증에서 디스크와 한 번 맞춰 본다. */
  updateFileText(uri: string, text: string, stamp?: FileStamp): void {
    const file = this.pool.id(uri);
    const extract = extractUsages(uri, text, { pool: this.pool, file, hasCanonical: this.hasCanonical });
    this.applyExtracted(file, extract, stamp);
  }

  /** 추출 결과를 색인에 반영하는 단일 지점 — 스캔·증분·스냅샷 복원이 모두 이 경로를 지난다. */
  private applyExtracted(file: StringId, extract: UsageExtract, stamp?: FileStamp): void {
    if (stamp) this.stamps.set(file, stamp); else this.stamps.delete(file);
    this.removeFileEntries(file);

    for (const e of extract.strings) this.addEntry(e);
    for (const e of extract.templates) this.addTemplateEntry(e);
    for (const e of extract.amd) this.addAmdEntry(e);
    for (const e of extract.config) this.addConfigEntry(e);
    for (const e of extract.tables) this.addTableEntry(e);

    const hasAny = extract.strings.length || extract.templates.length || extract.amd.length
      || extract.config.length || extract.tables.length;
    if (hasAny) this.byFile.set(file, extract);
  }

  /** 게시 목록에서 한 파일의 항목만 걸러낸다 — 위치가 수치가 된 뒤로는 객체 동일성이 아니라
   *  그 항목의 file id로 판별해야 한다. 걸러낸 배열이 비면 키째로 지운다 — 그러지 않으면 저장을
   *  반복하거나 revalidateFromRoot를 돌릴 때마다 한 번이라도 등장했던 (component, key)·ref·id·이름마다
   *  빈 배열이 맵에 영영 남는다. */
  private removeFileEntries(file: StringId): void {
    const prev = this.byFile.get(file);
    if (!prev) return;
    for (const e of prev.strings) {
      const keys = this.byComponentKey.get(e.component);
      if (keys) {
        removeFileFromMap(keys, e.key, file);
        if (keys.size === 0) this.byComponentKey.delete(e.component);
      }
    }
    for (const e of prev.templates) removeFileFromMap(this.byTemplateRef, e.ref, file);
    for (const e of prev.amd) removeFileFromMap(this.byAmdRef, e.ref, file);
    for (const e of prev.config) removeFileFromMap(this.byConfigId, e.id, file);
    for (const e of prev.tables) removeFileFromMap(this.byTableName, e.name, file);
    this.byFile.delete(file);
  }

  /** 색인이 아는 모든 파일(id) — 도장이 있는 파일과 항목이 있는 파일의 합집합. */
  private trackedFiles(): StringId[] {
    return [...new Set([...this.stamps.keys(), ...this.byFile.keys()])];
  }

  /** 도장 행 — 도장이 없는 파일(저장 증분으로 갱신된 파일)은 size 음수로 담아 다음 검증에서 다시 읽는다. */
  private stampRows(root: string): StampRow[] {
    return this.trackedFiles()
      .map(file => ({ file, uri: this.pool.text(file) }))
      .filter(f => insideRoot(root, f.uri))
      .map(f => {
        const s = this.stamps.get(f.file);
        return [path.relative(root, f.uri), s?.mtimeMs ?? 0, s?.size ?? -1] as StampRow;
      });
  }

  toSnapshot(root: string, extVersion: string): UsageSnapshot {
    const files = this.trackedFiles().filter(f => insideRoot(root, this.pool.text(f)));
    const idxOf = new Map(files.map((f, i) => [f, i] as const));
    // byFile을 한 번 훑으며 다섯 종류를 나란히 뽑는다 — sel이 그때그때 어느 배열을 볼지 고른다.
    const rows = <T>(sel: (e: UsageExtract) => readonly T[]): Iterable<[number, readonly T[]]> =>
      [...this.byFile].flatMap(([f, extract]) => {
        const i = idxOf.get(f);
        return i === undefined ? [] : [[i, sel(extract)] as [number, readonly T[]]];
      });
    return {
      v: SNAPSHOT_VERSION, ext: extVersion, root,
      files: this.stampRows(root),
      s: packRows(rows(e => e.strings), e => [this.pool.text(e.component), this.pool.text(e.key), e.line, e.column]),
      t: packRows(rows(e => e.templates), e => [this.pool.text(e.ref), e.line, e.column]),
      a: packRows(rows(e => e.amd), e => [this.pool.text(e.ref), e.line, e.column]),
      c: packRows(rows(e => e.config), e => [this.pool.text(e.id), e.line, e.column]),
      x: packRows(rows(e => e.tables), e => [this.pool.text(e.name), e.line, e.column]),
    };
  }

  /** 색인을 빈 상태로 — 전체 빌드·복원이 앞선 내용을 물려받지 않게 한다. 풀도 새로 만든다 —
   *  그러지 않으면 재빌드마다 옛 풀의 문자열이 쓰이지 않아도 계속 쌓인다. */
  private reset(): void {
    this.pool = new StringPool();
    this.byComponentKey = new Map(); this.byFile = new Map();
    this.byTemplateRef = new Map(); this.byAmdRef = new Map();
    this.byConfigId = new Map(); this.byTableName = new Map();
    this.stamps = new Map();
  }

  /** 스냅샷으로 색인을 채운다 — 컴포넌트 정규화는 저장 시점에 끝나 있으므로 다시 하지 않는다.
   *  JSON에서 온 문자열은 조각이 아니지만, 풀을 지나야 같은 값이 하나의 id를 공유한다. */
  loadSnapshot(snap: UsageSnapshot, root: string): void {
    this.reset();

    const files = snap.files.map(([rel]) => path.join(root, rel));
    const fileIds = files.map(f => this.pool.id(f));
    snap.files.forEach(([, mtimeMs, size], i) => { if (size >= 0) this.stamps.set(fileIds[i], { mtimeMs, size }); });

    const per = new Map<number, UsageExtract>();
    const slot = (i: number): UsageExtract => {
      let e = per.get(i);
      if (!e) { e = emptyExtract(); per.set(i, e); }
      return e;
    };
    const known = (i: number): boolean => files[i] !== undefined; // 손상된 스냅샷의 범위 밖 인덱스는 버린다
    unpackRows(snap.s, 4, (i, r) => { if (known(i)) slot(i).strings.push({
      component: this.pool.id(r[0] as string), key: this.pool.id(r[1] as string),
      file: fileIds[i], line: r[2] as number, column: r[3] as number }); });
    unpackRows(snap.t, 3, (i, r) => { if (known(i)) slot(i).templates.push({
      ref: this.pool.id(r[0] as string), file: fileIds[i], line: r[1] as number, column: r[2] as number }); });
    unpackRows(snap.a, 3, (i, r) => { if (known(i)) slot(i).amd.push({
      ref: this.pool.id(r[0] as string), file: fileIds[i], line: r[1] as number, column: r[2] as number }); });
    unpackRows(snap.c, 3, (i, r) => { if (known(i)) slot(i).config.push({
      id: this.pool.id(r[0] as string), file: fileIds[i], line: r[1] as number, column: r[2] as number }); });
    unpackRows(snap.x, 3, (i, r) => { if (known(i)) slot(i).tables.push({
      name: this.pool.id(r[0] as string), file: fileIds[i], line: r[1] as number, column: r[2] as number }); });

    // 파일 인덱스 순서로 적용한다 — 종류별로 채운 순서를 그대로 쓰면 위치 배열 순서가 스캔과 달라진다.
    for (const i of [...per.keys()].sort((x, y) => x - y)) {
      this.applyExtracted(fileIds[i], per.get(i)!, this.stamps.get(fileIds[i]));
    }
    this.builtFlag = true;
  }

  /** 캐시로 채운 색인을 디스크와 맞춘다 — 빠른 순회 + 병렬 stat로 도장을 비교하고 바뀐 파일만 다시 읽는다.
   *  바뀐 것이 있으면 true(호출자가 화면을 다시 그린다). */
  async revalidateFromRoot(root: string): Promise<boolean> {
    const scan = await listSourceFiles(root);
    const { rows, failures } = await statAll(scan.files, root);
    const { changed, removed } = diffStamps(this.stampRows(root), rows);
    // 순회·stat 실패는 침묵으로 삼켜지므로 "사라졌다"와 구별되지 않는다. 하나라도 실패했으면
    // 삭제는 적용하지 않는다 — 잘못된 대량 삭제를 색인과 캐시에 굽는 쪽이 훨씬 비싸다.
    const applyRemoved = scan.failures === 0 && failures === 0;
    if (applyRemoved) for (const rel of removed) this.updateFileText(path.join(root, rel), '');
    for (let i = 0; i < changed.length; i += READ_CHUNK) {
      const chunk = changed.slice(i, i + READ_CHUNK).map(rel => path.join(root, rel));
      const read = await Promise.all(chunk.map(readWithStamp));
      for (const r of read) if (r) this.updateFileText(r.file, r.text, r.stamp);
      await new Promise<void>(r => setImmediate(r)); // 이벤트 루프 양보 — 백그라운드에서 돈다
    }
    return changed.length > 0 || (applyRemoved && removed.length > 0);
  }

  /** id로 저장된 위치를 조회 시점에 되살린다 — 한 번 조회가 돌려주는 위치는 많아야 수백 건이라 비용이 없다. */
  private location(e: { file: StringId; line: number; column: number }): SourceLocation {
    return { uri: this.pool.text(e.file), line: e.line, column: e.column };
  }

  // 다섯 조회 메서드 모두 find()만 쓴다 — id()를 쓰면 없는 값을 조회할 때마다(예: 미색인 컴포넌트를
  // 호버) 풀이 한 항목씩 자라 무한정 커진다.
  referencesOf(component: string, key: string): SourceLocation[] {
    const c = this.pool.find(component);
    const k = c === undefined ? undefined : this.pool.find(key);
    if (c === undefined || k === undefined) return [];
    return (this.byComponentKey.get(c)?.get(k) ?? []).map(e => this.location(e));
  }

  templateRefsOf(component: string, name: string): SourceLocation[] {
    const ref = this.pool.find(`${component}/${name}`);
    return ref === undefined ? [] : (this.byTemplateRef.get(ref) ?? []).map(e => this.location(e));
  }

  amdRefsOf(component: string, name: string): SourceLocation[] {
    const ref = this.pool.find(`${component}/${name}`);
    return ref === undefined ? [] : (this.byAmdRef.get(ref) ?? []).map(e => this.location(e));
  }

  configRefsOf(plugin: string, key: string): SourceLocation[] {
    const id = this.pool.find(configKeyId(plugin, key));
    return id === undefined ? [] : (this.byConfigId.get(id) ?? []).map(e => this.location(e));
  }

  tableRefsOf(name: string): SourceLocation[] {
    const id = this.pool.find(name);
    return id === undefined ? [] : (this.byTableName.get(id) ?? []).map(e => this.location(e));
  }

  private addEntry(e: StringUsage): void {
    let comp = this.byComponentKey.get(e.component);
    if (!comp) { comp = new Map(); this.byComponentKey.set(e.component, comp); }
    pushToMap(comp, e.key, e);
  }
  private addTemplateEntry(e: RefUsage): void { pushToMap(this.byTemplateRef, e.ref, e); }
  private addAmdEntry(e: RefUsage): void { pushToMap(this.byAmdRef, e.ref, e); }
  private addConfigEntry(e: ConfigUsage): void { pushToMap(this.byConfigId, e.id, e); }
  private addTableEntry(e: TableUsage): void { pushToMap(this.byTableName, e.name, e); }
}

/** 없으면 새 배열로 만들고, 있으면 이어붙인다. */
function pushToMap<K, T>(map: Map<K, T[]>, key: K, e: T): void {
  const arr = map.get(key);
  if (arr) arr.push(e); else map.set(key, [e]);
}

/** 한 파일의 항목만 걸러낸 배열로 되돌려 놓는다. 다 걸러져 비면 키를 지운다 —
 *  조회부는 이미 `?? []`로 없는 키를 빈 배열과 같게 다루므로 의미는 그대로다. */
function removeFileFromMap<K, T extends { file: StringId }>(map: Map<K, T[]>, key: K, file: StringId): void {
  const arr = map.get(key);
  if (!arr) return;
  const filtered = arr.filter(x => x.file !== file);
  if (filtered.length) map.set(key, filtered); else map.delete(key);
}

/** 루트 재귀 소스 파일(.php/.js) 열거 — realpath 순환 가드, 채택 여부는 isIndexableSourcePath로 통일해
 *  콜드 스캔과 저장 증분의 제외 규칙이 갈라지지 않게 한다. */
async function listSourceFiles(root: string): Promise<Scan> {
  const out: string[] = [];
  const seen = new Set<string>();
  let failures = 0;
  /** `real`은 dir의 실경로. 링크로 들어갈 때만 realpath를 부르고, 일반 하위 디렉터리는 부모 실경로에 이름을 붙여 만든다 —
   *  디렉터리마다 realpath를 부르면 열거 비용이 몇 배가 되지만, dedupe 집합에는 모든 디렉터리가 들어가야
   *  실경로와 링크로 두 번 도달하는 디렉터리를 두 번 훑지 않는다. */
  async function walk(dir: string, real: string): Promise<void> {
    if (seen.has(real)) return;
    seen.add(real);
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { failures++; return; }
    const subs: Promise<void>[] = [];
    for (const d of entries) {
      if (SKIP_DIRS.has(d.name)) continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) subs.push(walk(p, path.join(real, d.name)));
      else if (d.isSymbolicLink()) {
        subs.push((async () => {
          try {
            if (!(await fs.promises.stat(p)).isDirectory()) return;
            await walk(p, await fs.promises.realpath(p));
          } catch { /* 깨진 링크 무시 */ }
        })());
      } else if (d.isFile() && isIndexableSourcePath(root, p)) out.push(p);
    }
    await Promise.all(subs);
  }
  let rootReal = root;
  try { rootReal = await fs.promises.realpath(root); } catch { failures++; }
  await walk(root, rootReal);
  // 병렬 열거는 완료 순서가 갈리므로 정렬해 스캔 순서를 고정한다 — 항목 배열의 순서가 실행마다 달라지지 않게.
  return { files: out.sort(), failures };
}

/** 파일 도장을 병렬로 모은다 — 읽지 않으므로 검증은 스캔보다 훨씬 싸다. */
async function statAll(files: readonly string[], root: string): Promise<{ rows: StampRow[]; failures: number }> {
  const out: StampRow[] = [];
  let failures = 0;
  for (let i = 0; i < files.length; i += STAT_CHUNK) {
    const chunk = files.slice(i, i + STAT_CHUNK);
    const rows = await Promise.all(chunk.map(async f => {
      try {
        const st = await fs.promises.stat(f);
        return [path.relative(root, f), st.mtimeMs, st.size] as StampRow;
      } catch { return null; }
    }));
    for (const r of rows) { if (r) out.push(r); else failures++; }
    await new Promise<void>(r => setImmediate(r));
  }
  return { rows: out, failures };
}

/** 루트 밖 경로는 상대 경로로 담을 수 없고 검증도 못 한다 — 스냅샷에서 제외한다. */
function insideRoot(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** 읽기와 도장을 함께 — 도장은 캐시 검증에 쓰고, 실패한 파일은 건너뛴다(침묵). */
async function readWithStamp(file: string): Promise<{ file: string; text: string; stamp: FileStamp } | null> {
  try {
    const [st, text] = await Promise.all([fs.promises.stat(file), fs.promises.readFile(file, 'utf8')]);
    return { file, text, stamp: { mtimeMs: st.mtimeMs, size: st.size } };
  } catch { return null; }
}
