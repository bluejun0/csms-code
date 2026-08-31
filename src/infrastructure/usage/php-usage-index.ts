import * as fs from 'fs';
import * as path from 'path';
import { SourceLocation } from '../../domain/shared/value-objects';
import { StringUsageRepository } from '../../domain/lang-model/ports/string-usage-repository';
import { TemplateUsageRepository } from '../../domain/template-model/ports/template-usage-repository';
import { AmdUsageRepository } from '../../domain/amd-model/ports/amd-usage-repository';
import { ConfigUsageRepository } from '../../domain/moodle-model/ports/config-usage-repository';
import { configKeyId } from '../../domain/moodle-model/services/config-plugin';
import { SNAPSHOT_VERSION, StampRow, UsageSnapshot, diffStamps, packRows, unpackRows } from './usage-snapshot';
import { normalizeComponent } from '../../domain/lang-model/services/component-normalizer';
import { STRING_FUNCTION_ALTERNATION, STRING_CLASS_ALTERNATION, stringFunctionForm, stringClassForm, effectiveComponent } from '../../domain/code-analysis/string-functions';
import { scanJsCalls } from '../../domain/code-analysis/js-call-scanner';
import { scanMustache } from '../../domain/code-analysis/mustache-scanner';

// 리터럴 key + (닫힘 | 리터럴 component). 컴포넌트가 변수·보간이면 통째로 비매칭 — 기본 컴포넌트로 오귀속하지 않는다(침묵 원칙).
// 1=함수 이름 2=클래스 이름(`new` 꼴) 3=key 4=component(생략이면 undefined)
const USAGE_RE = new RegExp(String.raw`(?:\b(${STRING_FUNCTION_ALTERNATION})|new\s+\\?(${STRING_CLASS_ALTERNATION}))\(\s*['"]([\w:./-]+)['"]\s*(?:\)|,\s*['"](\w*)['"])`, 'g');
// 템플릿 사용처 — 같은 스캔에서 함께 수집한다(23초 스캔을 두 번 돌리지 않기 위해)
const TEMPLATE_USAGE_RE = /render_from_template\(\s*['"]([\w:./-]+)['"]/g;
// AMD 모듈 사용처 — 같은 스캔에서 함께 수집한다
const AMD_USAGE_RE = /js_call_amd\(\s*['"]([\w:./-]+)['"]/g;
// 설정 사용처 — get_config(plugin, key) / set_config(key, value, plugin). 값에 괄호가 있으면 어디서 끝나는지 정규식으로 알 수 없어 비매칭.
// `->get_config(…)`·`::get_config(…)`는 다른 의미의 메서드라 제외한다(팩트도 함수 호출만 본다).
const CONFIG_GET_RE = /(?<![>\w$:])get_config\(\s*['"](\w+)['"]\s*,\s*['"](\w+)['"]\s*\)/g;
const CONFIG_SET_RE = /(?<![>\w$:])set_config\(\s*['"](\w+)['"]\s*,\s*[^;()]*?,\s*['"](\w+)['"]\s*\)/g;
// 'lang'은 lang 팩 자체 — 사용처가 아니고, 값 텍스트 속 "get_string(" 유령 매치 방지를 겸한다
const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', '.superpowers', 'dist', 'lang']);
const YIELD_EVERY = 200;
const READ_CHUNK = 16;   // 읽기 동시 수 — 순차 대비 4배가량, 8~32 구간에서 평탄하다
const STAT_CHUNK = 64;   // stat은 읽기보다 싸다

/** 캐시 검증용 파일 도장 — 내용을 다시 읽지 않고 mtime·size로 판정한다. */
export interface FileStamp { mtimeMs: number; size: number; }

/** 열거 결과. `failures`는 읽지 못한 디렉터리 수 — 0이 아니면 "파일이 사라졌다"고 단정할 수 없다. */
interface Scan { files: string[]; failures: number }

interface UsageEntry { component: string; key: string; loc: SourceLocation; }
interface TemplateEntry { ref: string; loc: SourceLocation; }
interface AmdEntry { ref: string; loc: SourceLocation; }
interface ConfigEntry { id: string; loc: SourceLocation; }
interface Extracted { entries: UsageEntry[]; tEntries: TemplateEntry[]; aEntries: AmdEntry[]; cEntries: ConfigEntry[]; }

/** 문자열·템플릿·AMD·설정 사용처의 워크스페이스 색인 — PHP·JS·mustache를 한 번의 스캔에서 함께 훑는다.
 *  lazy 빌드 + 저장/삭제 시 파일 단위 증분. */
export class PhpUsageIndex implements StringUsageRepository, TemplateUsageRepository, AmdUsageRepository, ConfigUsageRepository {
  private byComponent = new Map<string, Map<string, SourceLocation[]>>();
  private byFile = new Map<string, UsageEntry[]>();
  private byTemplateRef = new Map<string, SourceLocation[]>();
  private templatesByFile = new Map<string, TemplateEntry[]>();
  private byAmdRef = new Map<string, SourceLocation[]>();
  private amdByFile = new Map<string, AmdEntry[]>();
  private byConfigId = new Map<string, SourceLocation[]>();
  private configByFile = new Map<string, ConfigEntry[]>();
  private stamps = new Map<string, FileStamp>();
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

  /** 파일 단위 증분: 기존 항목 제거 후 재추출 (저장 시 호출). 확장자로 PHP/JS 추출기를 고른다.
   *  `stamp`를 주면 기록하고, 주지 않으면 그 파일 도장을 지운다 — 저장 시점에는 mtime을 모르므로
   *  다음 검증에서 디스크와 한 번 맞춰 본다. */
  updateFileText(uri: string, text: string, stamp?: FileStamp): void {
    this.applyExtracted(uri, uri.endsWith('.js') ? this.extractJs(uri, text)
      : uri.endsWith('.mustache') ? this.extractMustache(uri, text)
        : this.extractPhp(uri, text), stamp);
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

  private extractPhp(uri: string, text: string): Extracted {
    const entries: UsageEntry[] = [];
    const tEntries: TemplateEntry[] = [];
    const aEntries: AmdEntry[] = [];
    const cEntries: ConfigEntry[] = [];
    // 키 리터럴 내용 시작 = 매치 안 첫 따옴표 다음
    const firstLiteralColumn = (m: RegExpExecArray, lineStart: number) => m.index - lineStart + m[0].search(/['"]/) + 1;
    forEachMatch(text, USAGE_RE, (m, line, lineStart) => {
      const form = m[1] ? stringFunctionForm(m[1]) : stringClassForm(m[2]);
      if (!form) return;
      const component = normalizeComponent(effectiveComponent(form, m[4] ?? ''), this.hasCanonical);
      entries.push({ component, key: m[3], loc: { uri, line, column: firstLiteralColumn(m, lineStart) } });
    });
    forEachMatch(text, TEMPLATE_USAGE_RE, (m, line, lineStart) => {
      tEntries.push({ ref: m[1], loc: { uri, line, column: firstLiteralColumn(m, lineStart) } });
    });
    forEachMatch(text, AMD_USAGE_RE, (m, line, lineStart) => {
      aEntries.push({ ref: m[1], loc: { uri, line, column: firstLiteralColumn(m, lineStart) } });
    });
    forEachMatch(text, CONFIG_GET_RE, (m, line, lineStart) => {
      const keyOffset = m[0].indexOf(m[2], m[0].indexOf(',')); // 둘째 리터럴의 내용 시작
      cEntries.push({ id: configKeyId(m[1], m[2]), loc: { uri, line, column: m.index - lineStart + keyOffset } });
    });
    forEachMatch(text, CONFIG_SET_RE, (m, line, lineStart) => {
      cEntries.push({ id: configKeyId(m[2], m[1]), loc: { uri, line, column: firstLiteralColumn(m, lineStart) } });
    });
    return { entries, tEntries, aEntries, cEntries };
  }

  /** mustache의 `{{> }}`·`{{< }}`는 템플릿 사용처, `{{#str}}`는 문자열 사용처다.
   *  component는 PHP 경로와 같은 정규화를 거쳐야 lang 쪽 참조 목록에서 갈리지 않는다. */
  private extractMustache(uri: string, text: string): Extracted {
    const refs = scanMustache(text);
    return {
      aEntries: [], cEntries: [],
      entries: refs.stringRefs.map(r => ({
        component: normalizeComponent(r.component, this.hasCanonical),
        key: r.key,
        loc: { uri, line: r.keyLine, column: r.keyColumn },
      })),
      tEntries: refs.templateRefs.map(r => ({ ref: r.ref, loc: { uri, line: r.line, column: r.column } })),
    };
  }

  /** JS에는 js_call_amd가 없다(모듈 로딩은 import·require) — aEntries는 항상 비어 있다. */
  private extractJs(uri: string, text: string): Extracted {
    const calls = scanJsCalls(text);
    return {
      aEntries: [], cEntries: [],
      entries: calls.stringCalls.map(c => ({
        component: normalizeComponent(c.component, this.hasCanonical),
        key: c.key,
        loc: { uri, line: c.keyLine, column: c.keyColumn },
      })),
      tEntries: calls.templateCalls.map(c => ({ ref: c.ref, loc: { uri, line: c.refLine, column: c.refColumn } })),
    };
  }

  /** 색인이 아는 모든 파일 — 도장이 있는 파일과 항목이 있는 파일의 합집합. */
  private trackedFiles(): string[] {
    return [...new Set([...this.stamps.keys(), ...this.byFile.keys(), ...this.templatesByFile.keys(),
      ...this.amdByFile.keys(), ...this.configByFile.keys()])];
  }

  /** 도장 행 — 도장이 없는 파일(저장 증분으로 갱신된 파일)은 size 음수로 담아 다음 검증에서 다시 읽는다. */
  private stampRows(root: string): StampRow[] {
    return this.trackedFiles().filter(f => insideRoot(root, f)).map(f => {
      const s = this.stamps.get(f);
      return [path.relative(root, f), s?.mtimeMs ?? 0, s?.size ?? -1] as StampRow;
    });
  }

  toSnapshot(root: string, extVersion: string): UsageSnapshot {
    const files = this.trackedFiles().filter(f => insideRoot(root, f));
    const idxOf = new Map(files.map((f, i) => [f, i] as const));
    const rows = <T>(m: Map<string, T[]>): Iterable<[number, readonly T[]]> =>
      [...m].flatMap(([f, list]) => {
        const i = idxOf.get(f);
        return i === undefined ? [] : [[i, list] as [number, readonly T[]]];
      });
    return {
      v: SNAPSHOT_VERSION, ext: extVersion, root,
      files: this.stampRows(root),
      s: packRows(rows(this.byFile), e => [e.component, e.key, e.loc.line, e.loc.column]),
      t: packRows(rows(this.templatesByFile), e => [e.ref, e.loc.line, e.loc.column]),
      a: packRows(rows(this.amdByFile), e => [e.ref, e.loc.line, e.loc.column]),
      c: packRows(rows(this.configByFile), e => [e.id, e.loc.line, e.loc.column]),
    };
  }

  /** 색인을 빈 상태로 — 전체 빌드·복원이 앞선 내용을 물려받지 않게 한다. */
  private reset(): void {
    this.byComponent = new Map(); this.byFile = new Map();
    this.byTemplateRef = new Map(); this.templatesByFile = new Map();
    this.byAmdRef = new Map(); this.amdByFile = new Map();
    this.byConfigId = new Map(); this.configByFile = new Map();
    this.stamps = new Map();
  }

  /** 스냅샷으로 색인을 채운다 — 컴포넌트 정규화는 저장 시점에 끝나 있으므로 다시 하지 않는다. */
  loadSnapshot(snap: UsageSnapshot, root: string): void {
    this.reset();

    const files = snap.files.map(([rel]) => path.join(root, rel));
    snap.files.forEach(([, mtimeMs, size], i) => { if (size >= 0) this.stamps.set(files[i], { mtimeMs, size }); });

    const per = new Map<number, Extracted>();
    const slot = (i: number): Extracted => {
      let e = per.get(i);
      if (!e) { e = { entries: [], tEntries: [], aEntries: [], cEntries: [] }; per.set(i, e); }
      return e;
    };
    const known = (i: number): boolean => files[i] !== undefined; // 손상된 스냅샷의 범위 밖 인덱스는 버린다
    const at = (i: number, line: number, column: number): SourceLocation => ({ uri: files[i], line, column });
    unpackRows(snap.s, 4, (i, r) => { if (known(i)) slot(i).entries.push({
      component: r[0] as string, key: r[1] as string, loc: at(i, r[2] as number, r[3] as number) }); });
    unpackRows(snap.t, 3, (i, r) => { if (known(i)) slot(i).tEntries.push({ ref: r[0] as string, loc: at(i, r[1] as number, r[2] as number) }); });
    unpackRows(snap.a, 3, (i, r) => { if (known(i)) slot(i).aEntries.push({ ref: r[0] as string, loc: at(i, r[1] as number, r[2] as number) }); });
    unpackRows(snap.c, 3, (i, r) => { if (known(i)) slot(i).cEntries.push({ id: r[0] as string, loc: at(i, r[1] as number, r[2] as number) }); });

    // 파일 인덱스 순서로 적용한다 — 종류별로 채운 순서를 그대로 쓰면 위치 배열 순서가 스캔과 달라진다.
    for (const i of [...per.keys()].sort((x, y) => x - y)) {
      this.applyExtracted(files[i], per.get(i)!, this.stamps.get(files[i]));
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

  referencesOf(component: string, key: string): SourceLocation[] {
    return this.byComponent.get(component)?.get(key) ?? [];
  }

  templateRefsOf(component: string, name: string): SourceLocation[] {
    return this.byTemplateRef.get(`${component}/${name}`) ?? [];
  }

  amdRefsOf(component: string, name: string): SourceLocation[] {
    return this.byAmdRef.get(`${component}/${name}`) ?? [];
  }

  configRefsOf(plugin: string, key: string): SourceLocation[] {
    return this.byConfigId.get(configKeyId(plugin, key)) ?? [];
  }

  private addEntry(e: UsageEntry): void {
    let comp = this.byComponent.get(e.component);
    if (!comp) { comp = new Map(); this.byComponent.set(e.component, comp); }
    let arr = comp.get(e.key);
    if (!arr) { arr = []; comp.set(e.key, arr); }
    arr.push(e.loc);
  }
  private removeEntry(e: UsageEntry): void {
    const arr = this.byComponent.get(e.component)?.get(e.key);
    if (!arr) return;
    const i = arr.indexOf(e.loc);
    if (i >= 0) arr.splice(i, 1);
  }
  private addTemplateEntry(e: TemplateEntry): void {
    const arr = this.byTemplateRef.get(e.ref);
    if (arr) arr.push(e.loc); else this.byTemplateRef.set(e.ref, [e.loc]);
  }
  private removeTemplateEntry(e: TemplateEntry): void {
    const arr = this.byTemplateRef.get(e.ref);
    if (!arr) return;
    const i = arr.indexOf(e.loc);
    if (i >= 0) arr.splice(i, 1);
  }
  private addAmdEntry(e: AmdEntry): void {
    const arr = this.byAmdRef.get(e.ref);
    if (arr) arr.push(e.loc); else this.byAmdRef.set(e.ref, [e.loc]);
  }
  private removeAmdEntry(e: AmdEntry): void {
    const arr = this.byAmdRef.get(e.ref);
    if (!arr) return;
    const i = arr.indexOf(e.loc);
    if (i >= 0) arr.splice(i, 1);
  }
  private addConfigEntry(e: ConfigEntry): void {
    const arr = this.byConfigId.get(e.id);
    if (arr) arr.push(e.loc); else this.byConfigId.set(e.id, [e.loc]);
  }
  private removeConfigEntry(e: ConfigEntry): void {
    const arr = this.byConfigId.get(e.id);
    if (!arr) return;
    const i = arr.indexOf(e.loc);
    if (i >= 0) arr.splice(i, 1);
  }
}

/** 매치마다 (줄, 줄 시작 오프셋)을 누적해서 준다 — 매치마다 앞을 되짚으면 매치 수에 제곱이 된다. */
function forEachMatch(text: string, re: RegExp, fn: (m: RegExpExecArray, line: number, lineStart: number) => void): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  let lastIdx = 0, line = 0, lineStart = 0;
  while ((m = re.exec(text))) {
    for (let i = lastIdx; i < m.index; i++) if (text.charCodeAt(i) === 10) { line++; lineStart = i + 1; }
    lastIdx = m.index;
    fn(m, line, lineStart);
  }
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

/** 콜드 스캔과 저장 증분이 같은 제외 규칙을 쓰게 하는 단일 술어.
 *  amd/build는 amd/src의 미니파이 사본이라 색인하면 참조가 중복되고 생성 파일로 점프한다. */
export function isIndexableSourcePath(root: string, fsPath: string): boolean {
  if (!fsPath.endsWith('.php') && !fsPath.endsWith('.js') && !fsPath.endsWith('.mustache')) return false;
  if (fsPath.endsWith('.min.js')) return false;
  const rel = path.relative(root, fsPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const segs = rel.split(path.sep);
  if (segs.some(seg => SKIP_DIRS.has(seg))) return false;
  return !segs.some((seg, i) => seg === 'build' && segs[i - 1] === 'amd');
}
