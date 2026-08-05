import * as fs from 'fs';
import * as path from 'path';
import { SourceLocation } from '../../domain/shared/value-objects';
import { StringUsageRepository } from '../../domain/lang-model/ports/string-usage-repository';
import { TemplateUsageRepository } from '../../domain/template-model/ports/template-usage-repository';
import { normalizeComponent } from '../../domain/lang-model/services/component-normalizer';

// 리터럴 key(+선택적 리터럴 component) — 변수/보간은 비매칭(침묵 원칙)
const USAGE_RE = /get_string\(\s*['"]([\w:./-]+)['"]\s*(?:,\s*['"](\w+)['"])?/g;
// 템플릿 사용처 — 같은 스캔에서 함께 수집한다(23초 스캔을 두 번 돌리지 않기 위해)
const TEMPLATE_USAGE_RE = /render_from_template\(\s*['"]([\w:./-]+)['"]/g;
// 'lang'은 lang 팩 자체 — 사용처가 아니고, 값 텍스트 속 "get_string(" 유령 매치 방지를 겸한다
const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', '.superpowers', 'dist', 'lang']);
const YIELD_EVERY = 200;

interface UsageEntry { component: string; key: string; loc: SourceLocation; }
interface TemplateEntry { ref: string; loc: SourceLocation; }

/** get_string·render_from_template 사용처의 워크스페이스 색인 — lazy 빌드 + 저장/삭제 시 파일 단위 증분.
 *  두 종류를 한 번의 파일 읽기에서 함께 추출한다(스캔 중복 방지). */
export class PhpUsageIndex implements StringUsageRepository, TemplateUsageRepository {
  private byComponent = new Map<string, Map<string, SourceLocation[]>>();
  private byFile = new Map<string, UsageEntry[]>();
  private byTemplateRef = new Map<string, SourceLocation[]>();
  private templatesByFile = new Map<string, TemplateEntry[]>();
  private builtFlag = false;

  constructor(private hasCanonical: (c: string) => boolean) {}

  get isBuilt(): boolean { return this.builtFlag; }

  async buildFromRoot(root: string, onProgress?: (done: number, total: number) => void): Promise<void> {
    const files = await listPhpFiles(root);
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

  /** 파일 단위 증분: 기존 항목 제거 후 재추출 (저장 시 호출) */
  updateFileText(uri: string, text: string): void {
    const prev = this.byFile.get(uri);
    if (prev) { for (const e of prev) this.removeEntry(e); this.byFile.delete(uri); }
    const entries: UsageEntry[] = [];
    USAGE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    let lastIdx = 0, lastLine = 0; // 증분 라인 계산 — 전체 접두부 재스캔(O(n²)) 금지
    while ((m = USAGE_RE.exec(text))) {
      for (let i = lastIdx; i < m.index; i++) if (text.charCodeAt(i) === 10) lastLine++;
      lastIdx = m.index;
      const component = m[2] ? normalizeComponent(m[2], this.hasCanonical) : 'core';
      const lineStart = text.lastIndexOf('\n', m.index) + 1;
      const column = m.index - lineStart + m[0].search(/['"]/) + 1; // 키 리터럴 내용 시작 = 첫 따옴표 다음
      const e: UsageEntry = { component, key: m[1], loc: { uri, line: lastLine, column } };
      entries.push(e);
      this.addEntry(e);
    }
    if (entries.length) this.byFile.set(uri, entries);

    const prevT = this.templatesByFile.get(uri);
    if (prevT) { for (const e of prevT) this.removeTemplateEntry(e); this.templatesByFile.delete(uri); }
    const tEntries: TemplateEntry[] = [];
    TEMPLATE_USAGE_RE.lastIndex = 0;
    let tLastIdx = 0, tLastLine = 0;
    while ((m = TEMPLATE_USAGE_RE.exec(text))) {
      for (let i = tLastIdx; i < m.index; i++) if (text.charCodeAt(i) === 10) tLastLine++;
      tLastIdx = m.index;
      const lineStart = text.lastIndexOf('\n', m.index) + 1;
      const column = m.index - lineStart + m[0].search(/['"]/) + 1;
      const e: TemplateEntry = { ref: m[1], loc: { uri, line: tLastLine, column } };
      tEntries.push(e);
      this.addTemplateEntry(e);
    }
    if (tEntries.length) this.templatesByFile.set(uri, tEntries);
  }

  referencesOf(component: string, key: string): SourceLocation[] {
    return this.byComponent.get(component)?.get(key) ?? [];
  }

  templateRefsOf(component: string, name: string): SourceLocation[] {
    return this.byTemplateRef.get(`${component}/${name}`) ?? [];
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
}

/** 루트 재귀 PHP 파일 열거 — realpath 기준 순환 가드로 symlink 디렉터리도 안전하게 추적 */
async function listPhpFiles(root: string): Promise<string[]> {
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
      } else if (d.isFile() && d.name.endsWith('.php')) out.push(p);
    }
  }
  await walk(root);
  return out;
}

/** 저장 증분이 콜드 스캔과 같은 제외 규칙을 따르게 하는 가드 — 루트 밖·SKIP_DIRS 경로는 색인 대상 아님 */
export function isIndexablePhpPath(root: string, fsPath: string): boolean {
  if (!fsPath.endsWith('.php')) return false;
  const rel = path.relative(root, fsPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return !rel.split(path.sep).some(seg => SKIP_DIRS.has(seg));
}
