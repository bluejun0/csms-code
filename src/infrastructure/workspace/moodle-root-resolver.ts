import * as fs from 'fs';
import * as path from 'path';

/** 플러그인 타입 → 루트 기준 상대 디렉터리. 타입명과 디렉터리명이 다르거나(block→blocks)
 *  중첩된(tool→admin/tool) 경우가 많아 매핑이 필요하다 — 2026-08-05 hlulxp 실측 검증. */
export const PLUGIN_DIRS: Record<string, string> = {
  mod: 'mod', local: 'local', block: 'blocks', report: 'report', enrol: 'enrol',
  auth: 'auth', theme: 'theme', filter: 'filter', repository: 'repository',
  portfolio: 'portfolio', webservice: 'webservice',
  tool: 'admin/tool', format: 'course/format', qtype: 'question/type',
  gradereport: 'grade/report', gradeexport: 'grade/export', gradeimport: 'grade/import',
  message: 'message/output', availability: 'availability/condition',
  customfield: 'customfield/field', contenttype: 'contentbank/contenttype',
  profilefield: 'user/profile/field', datafield: 'mod/data/field', datapreset: 'mod/data/preset',
  cachestore: 'cache/stores', cachelock: 'cache/locks',
  editor: 'lib/editor', atto: 'lib/editor/atto/plugins', tinymce: 'lib/editor/tinymce/plugins',
  mlbackend: 'lib/mlbackend',
};

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
  for (const [type, relDir] of Object.entries(PLUGIN_DIRS)) {
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
  for (const [type, relDir] of Object.entries(PLUGIN_DIRS)) {
    const typeDir = path.join(root, relDir);
    if (!fs.existsSync(typeDir)) continue;
    for (const name of safeReaddir(typeDir)) {
      const expected = type === 'mod' ? `${name}.php` : `${type}_${name}.php`;
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
export function pluginTypeOfRel(rel: string): { type: string; name: string; rest: string } | null {
  const parts = rel.split(path.sep);
  let best: { type: string; name: string; rest: string; depth: number } | null = null;
  for (const [type, relDir] of Object.entries(PLUGIN_DIRS)) {
    const dirParts = relDir.split('/');
    if (parts.length < dirParts.length + 2) continue;
    if (!dirParts.every((seg, i) => parts[i] === seg)) continue;
    const depth = dirParts.length;
    if (best && best.depth >= depth) continue;
    best = { type, name: parts[depth], rest: parts.slice(depth + 1).join('/'), depth };
  }
  return best ? { type: best.type, name: best.name, rest: best.rest } : null;
}

/** lang 파일 경로 → component (listLangFiles 규칙의 역함수 — 순수 경로 로직). 규칙 밖은 null. */
export function componentOfLangFile(root: string, file: string): string | null {
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (parts.length === 3 && parts[0] === 'lang' && parts[1] === 'en' && parts[2].endsWith('.php')) {
    const base = parts[2].slice(0, -4);
    return base === 'moodle' ? 'core' : `core_${base}`;
  }
  const hit = pluginTypeOfRel(rel);
  if (!hit) return null;
  const restParts = hit.rest.split('/');
  if (restParts.length !== 3 || restParts[0] !== 'lang' || !LANG_LOCALES.includes(restParts[1])) return null;
  const expected = hit.type === 'mod' ? `${hit.name}.php` : `${hit.type}_${hit.name}.php`;
  return restParts[2] === expected ? `${hit.type}_${hit.name}` : null;
}
