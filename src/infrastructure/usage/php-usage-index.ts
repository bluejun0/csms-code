import * as fs from 'fs';
import * as path from 'path';
import { SourceLocation } from '../../domain/shared/value-objects';
import { StringUsageRepository } from '../../domain/lang-model/ports/string-usage-repository';
import { TemplateUsageRepository } from '../../domain/template-model/ports/template-usage-repository';
import { AmdUsageRepository } from '../../domain/amd-model/ports/amd-usage-repository';
import { normalizeComponent } from '../../domain/lang-model/services/component-normalizer';
import { scanJsCalls } from '../../domain/code-analysis/js-call-scanner';
import { scanMustache } from '../../domain/code-analysis/mustache-scanner';

// 리터럴 key(+선택적 리터럴 component) — 변수/보간은 비매칭(침묵 원칙)
const USAGE_RE = /get_string\(\s*['"]([\w:./-]+)['"]\s*(?:,\s*['"](\w+)['"])?/g;
// 템플릿 사용처 — 같은 스캔에서 함께 수집한다(23초 스캔을 두 번 돌리지 않기 위해)
const TEMPLATE_USAGE_RE = /render_from_template\(\s*['"]([\w:./-]+)['"]/g;
// AMD 모듈 사용처 — 같은 스캔에서 함께 수집한다
const AMD_USAGE_RE = /js_call_amd\(\s*['"]([\w:./-]+)['"]/g;
// 'lang'은 lang 팩 자체 — 사용처가 아니고, 값 텍스트 속 "get_string(" 유령 매치 방지를 겸한다
const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', '.superpowers', 'dist', 'lang']);
const YIELD_EVERY = 200;

interface UsageEntry { component: string; key: string; loc: SourceLocation; }
interface TemplateEntry { ref: string; loc: SourceLocation; }
interface AmdEntry { ref: string; loc: SourceLocation; }

/** 문자열·템플릿·AMD 사용처의 워크스페이스 색인 — PHP·JS·mustache를 한 번의 스캔에서 함께 훑는다.
 *  lazy 빌드 + 저장/삭제 시 파일 단위 증분. */
export class PhpUsageIndex implements StringUsageRepository, TemplateUsageRepository, AmdUsageRepository {
  private byComponent = new Map<string, Map<string, SourceLocation[]>>();
  private byFile = new Map<string, UsageEntry[]>();
  private byTemplateRef = new Map<string, SourceLocation[]>();
  private templatesByFile = new Map<string, TemplateEntry[]>();
  private byAmdRef = new Map<string, SourceLocation[]>();
  private amdByFile = new Map<string, AmdEntry[]>();
  private builtFlag = false;

  constructor(private hasCanonical: (c: string) => boolean) {}

  get isBuilt(): boolean { return this.builtFlag; }

  async buildFromRoot(root: string, onProgress?: (done: number, total: number) => void): Promise<void> {
    const files = await listSourceFiles(root);
    let done = 0;
    for (const f of files) {
      let text: string;
      try { text = await fs.promises.readFile(f, 'utf8'); } catch { done++; continue; }
      this.updateFileText(f, text);
      done++;
      if (done % YIELD_EVERY === 0) {
        onProgress?.(done, files.length);
        await new Promise<void>(r => setImmediate(r)); // 이벤트 루프 양보 — 확장 호스트 블록 방지
      }
    }
    onProgress?.(files.length, files.length);
    this.builtFlag = true;
  }

  /** 파일 단위 증분: 기존 항목 제거 후 재추출 (저장 시 호출). 확장자로 PHP/JS 추출기를 고른다. */
  updateFileText(uri: string, text: string): void {
    const prev = this.byFile.get(uri);
    if (prev) { for (const e of prev) this.removeEntry(e); this.byFile.delete(uri); }
    const prevT = this.templatesByFile.get(uri);
    if (prevT) { for (const e of prevT) this.removeTemplateEntry(e); this.templatesByFile.delete(uri); }
    const prevA = this.amdByFile.get(uri);
    if (prevA) { for (const e of prevA) this.removeAmdEntry(e); this.amdByFile.delete(uri); }

    const { entries, tEntries, aEntries } = uri.endsWith('.js') ? this.extractJs(uri, text)
      : uri.endsWith('.mustache') ? this.extractMustache(uri, text)
        : this.extractPhp(uri, text);

    for (const e of entries) this.addEntry(e);
    for (const e of tEntries) this.addTemplateEntry(e);
    for (const e of aEntries) this.addAmdEntry(e);
    if (entries.length) this.byFile.set(uri, entries);
    if (tEntries.length) this.templatesByFile.set(uri, tEntries);
    if (aEntries.length) this.amdByFile.set(uri, aEntries);
  }

  private extractPhp(uri: string, text: string): { entries: UsageEntry[]; tEntries: TemplateEntry[]; aEntries: AmdEntry[] } {
    const entries: UsageEntry[] = [];
    const tEntries: TemplateEntry[] = [];
    const aEntries: AmdEntry[] = [];
    USAGE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    let lastIdx = 0, lastLine = 0, lastLineStart = 0; // 증분 라인 계산 — 전체 접두부 재스캔(O(n²)) 금지
    while ((m = USAGE_RE.exec(text))) {
      for (let i = lastIdx; i < m.index; i++) {
        if (text.charCodeAt(i) === 10) { lastLine++; lastLineStart = i + 1; }
      }
      lastIdx = m.index;
      const component = m[2] ? normalizeComponent(m[2], this.hasCanonical) : 'core';
      const column = m.index - lastLineStart + m[0].search(/['"]/) + 1; // 키 리터럴 내용 시작 = 첫 따옴표 다음
      entries.push({ component, key: m[1], loc: { uri, line: lastLine, column } });
    }
    TEMPLATE_USAGE_RE.lastIndex = 0;
    let tLastIdx = 0, tLastLine = 0, tLastLineStart = 0;
    while ((m = TEMPLATE_USAGE_RE.exec(text))) {
      for (let i = tLastIdx; i < m.index; i++) {
        if (text.charCodeAt(i) === 10) { tLastLine++; tLastLineStart = i + 1; }
      }
      tLastIdx = m.index;
      const column = m.index - tLastLineStart + m[0].search(/['"]/) + 1;
      tEntries.push({ ref: m[1], loc: { uri, line: tLastLine, column } });
    }
    AMD_USAGE_RE.lastIndex = 0;
    let aLastIdx = 0, aLastLine = 0, aLastLineStart = 0;
    while ((m = AMD_USAGE_RE.exec(text))) {
      for (let i = aLastIdx; i < m.index; i++) {
        if (text.charCodeAt(i) === 10) { aLastLine++; aLastLineStart = i + 1; }
      }
      aLastIdx = m.index;
      const column = m.index - aLastLineStart + m[0].search(/['"]/) + 1;
      aEntries.push({ ref: m[1], loc: { uri, line: aLastLine, column } });
    }
    return { entries, tEntries, aEntries };
  }

  /** mustache의 `{{> }}`·`{{< }}`는 템플릿 사용처, `{{#str}}`는 문자열 사용처다.
   *  component는 PHP 경로와 같은 정규화를 거쳐야 lang 쪽 참조 목록에서 갈리지 않는다. */
  private extractMustache(uri: string, text: string): { entries: UsageEntry[]; tEntries: TemplateEntry[]; aEntries: AmdEntry[] } {
    const refs = scanMustache(text);
    return {
      aEntries: [],
      entries: refs.stringRefs.map(r => ({
        component: normalizeComponent(r.component, this.hasCanonical),
        key: r.key,
        loc: { uri, line: r.keyLine, column: r.keyColumn },
      })),
      tEntries: refs.templateRefs.map(r => ({ ref: r.ref, loc: { uri, line: r.line, column: r.column } })),
    };
  }

  /** JS에는 js_call_amd가 없다(모듈 로딩은 import·require) — aEntries는 항상 비어 있다. */
  private extractJs(uri: string, text: string): { entries: UsageEntry[]; tEntries: TemplateEntry[]; aEntries: AmdEntry[] } {
    const calls = scanJsCalls(text);
    return {
      aEntries: [],
      entries: calls.stringCalls.map(c => ({
        component: normalizeComponent(c.component, this.hasCanonical),
        key: c.key,
        loc: { uri, line: c.keyLine, column: c.keyColumn },
      })),
      tEntries: calls.templateCalls.map(c => ({ ref: c.ref, loc: { uri, line: c.refLine, column: c.refColumn } })),
    };
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
}

/** 루트 재귀 소스 파일(.php/.js) 열거 — realpath 순환 가드, 채택 여부는 isIndexableSourcePath로 통일해
 *  콜드 스캔과 저장 증분의 제외 규칙이 갈라지지 않게 한다. */
async function listSourceFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  async function walk(dir: string): Promise<void> {
    let real: string;
    try { real = await fs.promises.realpath(dir); } catch { return; }
    if (seen.has(real)) return;
    seen.add(real);
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const d of entries) {
      if (SKIP_DIRS.has(d.name)) continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) await walk(p);
      else if (d.isSymbolicLink()) {
        try { if ((await fs.promises.stat(p)).isDirectory()) await walk(p); } catch { /* 깨진 링크 무시 */ }
      } else if (d.isFile() && isIndexableSourcePath(root, p)) out.push(p);
    }
  }
  await walk(root);
  return out;
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
