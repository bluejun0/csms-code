import * as fs from 'fs';
import * as path from 'path';
import { SourceLocation } from '../../domain/shared/value-objects';
import { StringUsageRepository } from '../../domain/lang-model/ports/string-usage-repository';
import { TemplateUsageRepository } from '../../domain/template-model/ports/template-usage-repository';
import { AmdUsageRepository } from '../../domain/amd-model/ports/amd-usage-repository';
import { ConfigUsageRepository } from '../../domain/moodle-model/ports/config-usage-repository';
import { configKeyId } from '../../domain/moodle-model/services/config-plugin';
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
const CONFIG_GET_RE = /\bget_config\(\s*['"](\w+)['"]\s*,\s*['"](\w+)['"]\s*\)/g;
const CONFIG_SET_RE = /\bset_config\(\s*['"](\w+)['"]\s*,\s*[^;()]*?,\s*['"](\w+)['"]\s*\)/g;
// 'lang'은 lang 팩 자체 — 사용처가 아니고, 값 텍스트 속 "get_string(" 유령 매치 방지를 겸한다
const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', '.superpowers', 'dist', 'lang']);
const YIELD_EVERY = 200;

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
    const prevC = this.configByFile.get(uri);
    if (prevC) { for (const e of prevC) this.removeConfigEntry(e); this.configByFile.delete(uri); }

    const { entries, tEntries, aEntries, cEntries } = uri.endsWith('.js') ? this.extractJs(uri, text)
      : uri.endsWith('.mustache') ? this.extractMustache(uri, text)
        : this.extractPhp(uri, text);

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
