import * as fs from 'fs';
import * as path from 'path';

const PLUGIN_TYPES = ['mod','local','block','tool','report','enrol','auth','theme','format','qtype','filter','repository','portfolio','message','availability','customfield','contenttype','mlbackend','editor','atto','tinymce','profilefield','datafield','datapreset','gradeexport','gradeimport','gradereport','webservice','cachestore','cachelock'];

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
  for (const type of PLUGIN_TYPES) {
    const typeDir = path.join(root, type);
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
  for (const type of PLUGIN_TYPES) {
    const typeDir = path.join(root, type);
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

/** lang 파일 경로 → component (listLangFiles 규칙의 역함수 — 순수 경로 로직). 규칙 밖은 null. */
export function componentOfLangFile(root: string, file: string): string | null {
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (parts.length === 3 && parts[0] === 'lang' && parts[1] === 'en' && parts[2].endsWith('.php')) {
    const base = parts[2].slice(0, -4);
    return base === 'moodle' ? 'core' : `core_${base}`;
  }
  if (parts.length === 5 && parts[2] === 'lang' && LANG_LOCALES.includes(parts[3]) && parts[4].endsWith('.php')) {
    const [type, name] = parts;
    if (!PLUGIN_TYPES.includes(type)) return null;
    const expected = type === 'mod' ? `${name}.php` : `${type}_${name}.php`;
    return parts[4] === expected ? `${type}_${name}` : null;
  }
  return null;
}
