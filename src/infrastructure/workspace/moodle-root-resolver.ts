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
