import * as fs from 'fs';
import * as path from 'path';
import { pluginTypeDirs, pluginTypeDirsAsync, coreSubsystemDirs, coreSubsystemDirsAsync } from './plugin-type-map';

export function findMoodleRoot(startDir: string, detectInSubfolders: string[] = []): string | undefined {
  let dir = startDir;
  for (let i = 0; i < 40; i++) {
    if (isMoodleRoot(dir)) return dir;
    for (const sub of detectInSubfolders) {
      const cand = path.join(dir, sub);
      if (isMoodleRoot(cand)) return cand;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function isMoodleRoot(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'version.php')) &&
         fs.existsSync(path.join(dir, 'lib', 'db', 'install.xml'));
}

/** 코어 + 모든 플러그인의 db/install.xml 경로와 frankenstyle 컴포넌트명 */
export function listInstallXmlFiles(root: string): { file: string; component: string }[] {
  const out: { file: string; component: string }[] = [];
  const core = path.join(root, 'lib', 'db', 'install.xml');
  if (fs.existsSync(core)) out.push({ file: core, component: 'core' });
  for (const [type, relDir] of pluginTypeDirs(root)) {
    const typeDir = path.join(root, relDir);
    if (!fs.existsSync(typeDir)) continue;
    for (const name of safeReaddir(typeDir)) {
      const f = path.join(typeDir, name, 'db', 'install.xml');
      if (fs.existsSync(f)) out.push({ file: f, component: `${type}_${name}` });
    }
  }
  return out;
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() || (d.isSymbolicLink() && statIsDirectory(path.join(dir, d.name))))
      .map(d => d.name);
  } catch { return []; }
}

/** 심볼릭 링크의 실제 대상이 디렉터리인지 — statSync는 링크를 따라가고, 깨진 링크는 throw → false */
function statIsDirectory(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); }
  catch { return false; }
}

export interface LangFileRef { file: string; component: string; locale: string; }
const LANG_LOCALES = ['en', 'ko'];

/** 플러그인 lang 파일명 규칙 — mod만 `<name>.php`, 그 외는 `<type>_<name>.php`(Moodle 규칙).
 *  순방향 열거(동기·비동기)와 역방향 역산이 모두 이 함수를 쓴다. */
export function langFileNameFor(type: string, name: string): string {
  return type === 'mod' ? `${name}.php` : `${type}_${name}.php`;
}

/** 코어(lang/en/*.php — ko 언어팩은 저장소 밖) + 플러그인(lang/{en,ko})의 lang 파일 열거.
 *  mod 플러그인만 파일명이 `<name>.php`, 그 외는 `<type>_<name>.php` (Moodle 규칙). */
export function listLangFiles(root: string): LangFileRef[] {
  const out: LangFileRef[] = [];
  const coreDir = path.join(root, 'lang', 'en');
  for (const f of safeReaddirFiles(coreDir)) {
    if (!f.endsWith('.php')) continue;
    const base = f.slice(0, -4);
    out.push({ file: path.join(coreDir, f), component: base === 'moodle' ? 'core' : `core_${base}`, locale: 'en' });
  }
  for (const [type, relDir] of pluginTypeDirs(root)) {
    const typeDir = path.join(root, relDir);
    if (!fs.existsSync(typeDir)) continue;
    for (const name of safeReaddir(typeDir)) {
      const expected = langFileNameFor(type, name);
      for (const locale of LANG_LOCALES) {
        const f = path.join(typeDir, name, 'lang', locale, expected);
        if (fs.existsSync(f)) out.push({ file: f, component: `${type}_${name}`, locale });
      }
    }
  }
  return out;
}

function safeReaddirFiles(dir: string): string[] {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile()).map(d => d.name); }
  catch { return []; }
}

/** 루트 기준 상대경로에서 플러그인 타입·이름·나머지를 역산 — 다중 세그먼트 디렉터리 대응,
 *  최장 relDir 우선(예: `mod/data/field/x/…`는 datafield이지 mod가 아님). 규칙 밖은 null. */
export function pluginTypeOfRel(root: string, rel: string): { type: string; name: string; rest: string } | null {
  const parts = rel.split(path.sep);
  let best: { type: string; name: string; rest: string; depth: number } | null = null;
  for (const [type, relDir] of pluginTypeDirs(root)) {
    const dirParts = relDir.split('/');
    if (parts.length < dirParts.length + 2) continue;
    if (!dirParts.every((seg, i) => parts[i] === seg)) continue;
    const depth = dirParts.length;
    if (best && best.depth >= depth) continue;
    best = { type, name: parts[depth], rest: parts.slice(depth + 1).join('/'), depth };
  }
  return best ? { type: best.type, name: best.name, rest: best.rest } : null;
}

/** install.xml 경로 → component (listInstallXmlFiles 규칙의 역함수). 규칙 밖은 null. */
export function componentOfInstallXmlFile(root: string, file: string): string | null {
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (parts.length === 3 && parts[0] === 'lib' && parts[1] === 'db' && parts[2] === 'install.xml') return 'core';
  const hit = pluginTypeOfRel(root, rel);
  if (!hit) return null;
  return hit.rest === 'db/install.xml' ? `${hit.type}_${hit.name}` : null;
}

/** lang 파일 경로 → { component, locale }. 규칙 밖은 null. */
export function langFileMetaOf(root: string, file: string): { component: string; locale: string } | null {
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (parts.length === 3 && parts[0] === 'lang' && parts[1] === 'en' && parts[2].endsWith('.php')) {
    const base = parts[2].slice(0, -4);
    return { component: base === 'moodle' ? 'core' : `core_${base}`, locale: 'en' };
  }
  const hit = pluginTypeOfRel(root, rel);
  if (!hit) return null;
  const restParts = hit.rest.split('/');
  if (restParts.length !== 3 || restParts[0] !== 'lang' || !LANG_LOCALES.includes(restParts[1])) return null;
  const expected = langFileNameFor(hit.type, hit.name);
  return restParts[2] === expected ? { component: `${hit.type}_${hit.name}`, locale: restParts[1] } : null;
}

/** lang 파일 경로 → component (listLangFiles 규칙의 역함수 — 순수 경로 로직). 규칙 밖은 null. */
export function componentOfLangFile(root: string, file: string): string | null {
  return langFileMetaOf(root, file)?.component ?? null;
}

export interface TemplateFileRef { file: string; component: string; name: string; }

/** 컴포넌트꼴이면 테마 오버라이드 대상 컴포넌트로 본다(`local_ubattend`, `core`). */
function looksLikeComponent(seg: string): boolean { return seg === 'core' || seg.includes('_'); }

/** 템플릿 파일 경로 → { component, name } 역산. 규칙 밖(코어 서브시스템 등)은 null. */
export function componentOfTemplateFile(root: string, file: string): { component: string; name: string } | null {
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !rel.endsWith('.mustache')) return null;
  const parts = rel.split(path.sep);
  if (parts[0] === 'lib' && parts[1] === 'templates' && parts.length >= 3) {
    return { component: 'core', name: stripMustache(parts.slice(2).join('/')) };
  }
  const hit = pluginTypeOfRel(root, rel);
  if (!hit) return null;
  const restParts = hit.rest.split('/');
  if (restParts[0] !== 'templates' || restParts.length < 2) return null;
  const inner = restParts.slice(1);
  // 테마의 `templates/<component>/…`는 그 컴포넌트의 오버라이드
  if (hit.type === 'theme' && inner.length >= 2 && looksLikeComponent(inner[0])) {
    return { component: inner[0], name: stripMustache(inner.slice(1).join('/')) };
  }
  return { component: `${hit.type}_${hit.name}`, name: stripMustache(inner.join('/')) };
}

function stripMustache(s: string): string { return s.endsWith('.mustache') ? s.slice(0, -9) : s; }

/** 코어 + 모든 플러그인의 템플릿 파일 열거(하위 디렉터리 포함). */
export function listTemplateFiles(root: string): TemplateFileRef[] {
  const out: TemplateFileRef[] = [];
  const push = (file: string) => {
    const ref = componentOfTemplateFile(root, file);
    if (ref) out.push({ file, component: ref.component, name: ref.name });
  };
  const seen = new Set<string>();
  const walk = (dir: string) => {
    let real: string;
    try { real = fs.realpathSync(dir); } catch { return; }  // 깨진 링크 무시
    if (seen.has(real)) return;                              // 순환 가드 — 같은 파일 중복 수집 방지
    seen.add(real);
    for (const f of safeReaddirFiles(dir)) if (f.endsWith('.mustache')) push(path.join(dir, f));
    for (const d of safeReaddir(dir)) walk(path.join(dir, d));
  };
  const coreDir = path.join(root, 'lib', 'templates');
  if (fs.existsSync(coreDir)) walk(coreDir);
  for (const relDir of new Set(pluginTypeDirs(root).values())) {
    const typeDir = path.join(root, relDir);
    if (!fs.existsSync(typeDir)) continue;
    for (const name of safeReaddir(typeDir)) {
      const tdir = path.join(typeDir, name, 'templates');
      if (fs.existsSync(tdir)) walk(tdir);
    }
  }
  return out;
}

export interface AmdFileRef { file: string; component: string; name: string; }

/** AMD 모듈이 놓이는 `amd/src` 디렉터리와 그 컴포넌트 — 코어·코어 서브시스템·플러그인 순. */
function amdRoots(root: string): { dir: string; component: string }[] {
  const out = [{ dir: path.join(root, 'lib', 'amd', 'src'), component: 'core' }];
  for (const [sub, rel] of coreSubsystemDirs(root)) {
    out.push({ dir: path.join(root, rel, 'amd', 'src'), component: `core_${sub}` });
  }
  for (const [type, relDir] of pluginTypeDirs(root)) {
    const typeDir = path.join(root, relDir);
    if (!fs.existsSync(typeDir)) continue;
    for (const name of safeReaddir(typeDir)) {
      out.push({ dir: path.join(typeDir, name, 'amd', 'src'), component: `${type}_${name}` });
    }
  }
  return out;
}

/** `amd/src` 이하 경로에서 확장자를 뗀 모듈 이름. 구분자는 항상 `/` — 참조 문자열과 같은 형태여야 한다. */
function amdNameOf(srcDir: string, file: string): string {
  return path.relative(srcDir, file).split(path.sep).join('/').replace(/\.js$/, '');
}

/** 코어 + 코어 서브시스템 + 모든 플러그인의 `amd/src` JS 파일 열거(하위 디렉터리 포함).
 *  `amd/build`는 미니파이 사본이라 대상이 아니다. */
export function listAmdFiles(root: string): AmdFileRef[] {
  const out: AmdFileRef[] = [];
  // 순환 가드는 한 루트 안에서만 유효해야 한다 — 루트끼리 공유하면 두 컴포넌트가 같은
  // 디렉터리를 가리킬 때(심볼릭 링크) 먼저 도달한 쪽만 열거된다.
  const walk = (dir: string, srcDir: string, component: string, seen: Set<string>) => {
    let real: string;
    try { real = fs.realpathSync(dir); } catch { return; }
    if (seen.has(real)) return;
    seen.add(real);
    for (const f of safeReaddirFiles(dir)) {
      if (!f.endsWith('.js')) continue;
      const file = path.join(dir, f);
      out.push({ file, component, name: amdNameOf(srcDir, file) });
    }
    for (const d of safeReaddir(dir)) walk(path.join(dir, d), srcDir, component, seen);
  };
  for (const { dir, component } of amdRoots(root)) walk(dir, dir, component, new Set());
  return out;
}

/** `amd/src` 파일 → { component, name } (listAmdFiles 규칙의 역함수). 규칙 밖은 null. */
export function componentOfAmdFile(root: string, file: string): { component: string; name: string } | null {
  if (!file.endsWith('.js')) return null;
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  const i = parts.findIndex((seg, k) => seg === 'src' && parts[k - 1] === 'amd');
  if (i < 1) return null;
  const name = parts.slice(i + 1).join('/').replace(/\.js$/, '');
  if (!name) return null;
  const prefix = parts.slice(0, i - 1).join('/');
  if (prefix === 'lib') return { component: 'core', name };
  for (const [sub, relDir] of coreSubsystemDirs(root)) {
    if (prefix === relDir) return { component: `core_${sub}`, name };
  }
  // pluginTypeOfRel은 타입 디렉터리·플러그인 이름 뒤에 최소 한 세그먼트를 더 요구하므로
  // 플러그인 디렉터리까지만 남은 경로에는 더미 세그먼트를 붙여 호출한다.
  const hit = pluginTypeOfRel(root, path.join(...parts.slice(0, i - 1), 'x'));
  return hit ? { component: `${hit.type}_${hit.name}`, name } : null;
}

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

/** listInstallXmlFiles의 비동기 판 — 열거 방향(타입 맵 순회)·컴포넌트 조합 규칙은 동기판과 동일하고,
 *  등가성은 resolver.test.ts의 sync/async 비교 테스트가 고정한다. */
export async function listInstallXmlFilesAsync(root: string): Promise<{ file: string; component: string }[]> {
  const out: { file: string; component: string }[] = [];
  const typeDirs = await pluginTypeDirsAsync(root);
  const core = path.join(root, 'lib', 'db', 'install.xml');
  if (await existsAsync(core)) out.push({ file: core, component: 'core' });
  let n = 0;
  for (const [type, relDir] of typeDirs) {
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

/** listLangFiles의 비동기 판 — 파일명 규칙은 langFileNameFor를 공유한다. */
export async function listLangFilesAsync(root: string): Promise<LangFileRef[]> {
  const out: LangFileRef[] = [];
  const typeDirs = await pluginTypeDirsAsync(root);
  const coreDir = path.join(root, 'lang', 'en');
  for (const f of await safeReaddirFilesAsync(coreDir)) {
    if (!f.endsWith('.php')) continue;
    const base = f.slice(0, -4);
    out.push({ file: path.join(coreDir, f), component: base === 'moodle' ? 'core' : `core_${base}`, locale: 'en' });
  }
  let n = 0;
  for (const [type, relDir] of typeDirs) {
    const typeDir = path.join(root, relDir);
    if (!await existsAsync(typeDir)) continue;
    for (const name of await safeReaddirAsync(typeDir)) {
      const expected = langFileNameFor(type, name);
      for (const locale of LANG_LOCALES) {
        const f = path.join(typeDir, name, 'lang', locale, expected);
        if (await existsAsync(f)) out.push({ file: f, component: `${type}_${name}`, locale });
      }
      if (++n % INDEX_YIELD_EVERY === 0) await yieldNow();
    }
  }
  return out;
}

/** amdRoots의 비동기 판 — 컴포넌트 조합 규칙은 동기판과 같고 I/O만 비동기다.
 *  활성화 경로가 확장 호스트를 막지 않으려면 여기서도 동기 fs를 쓰지 않아야 한다. */
async function amdRootsAsync(root: string): Promise<{ dir: string; component: string }[]> {
  const out = [{ dir: path.join(root, 'lib', 'amd', 'src'), component: 'core' }];
  const typeDirs = await pluginTypeDirsAsync(root);
  for (const [sub, rel] of await coreSubsystemDirsAsync(root)) {
    out.push({ dir: path.join(root, rel, 'amd', 'src'), component: `core_${sub}` });
  }
  for (const [type, relDir] of typeDirs) {
    const typeDir = path.join(root, relDir);
    if (!await existsAsync(typeDir)) continue;
    for (const name of await safeReaddirAsync(typeDir)) {
      out.push({ dir: path.join(typeDir, name, 'amd', 'src'), component: `${type}_${name}` });
    }
  }
  return out;
}

/** listAmdFiles의 비동기 판 — 열거 대상(amdRoots)·이름 규칙(amdNameOf)을 동기판과 공유한다. */
export async function listAmdFilesAsync(root: string): Promise<AmdFileRef[]> {
  const out: AmdFileRef[] = [];
  let n = 0;
  const walk = async (dir: string, srcDir: string, component: string, seen: Set<string>): Promise<void> => {
    let real: string;
    try { real = await fs.promises.realpath(dir); } catch { return; }
    if (seen.has(real)) return;
    seen.add(real);
    for (const f of await safeReaddirFilesAsync(dir)) {
      if (!f.endsWith('.js')) continue;
      const file = path.join(dir, f);
      out.push({ file, component, name: amdNameOf(srcDir, file) });
      if (++n % INDEX_YIELD_EVERY === 0) await yieldNow();
    }
    for (const d of await safeReaddirAsync(dir)) await walk(path.join(dir, d), srcDir, component, seen);
  };
  for (const { dir, component } of await amdRootsAsync(root)) await walk(dir, dir, component, new Set());
  return out;
}

/** listTemplateFiles의 비동기 판 — realpath 순환 가드도 동일하게 유지 */
export async function listTemplateFilesAsync(root: string): Promise<TemplateFileRef[]> {
  const out: TemplateFileRef[] = [];
  const typeDirs = await pluginTypeDirsAsync(root);
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
  for (const relDir of new Set(typeDirs.values())) {
    const typeDir = path.join(root, relDir);
    if (!await existsAsync(typeDir)) continue;
    for (const name of await safeReaddirAsync(typeDir)) {
      const tdir = path.join(typeDir, name, 'templates');
      if (await existsAsync(tdir)) await walk(tdir);
    }
  }
  return out;
}
