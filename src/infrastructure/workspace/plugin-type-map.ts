import * as fs from 'fs';
import * as path from 'path';

/** 선언 파일이 없는 Moodle 버전용 폴백. 선언이 있으면 그쪽이 이기고, 없는 타입만 여기서 채워진다. */
export const STATIC_PLUGIN_DIRS: Record<string, string> = {
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

// `$subplugins = array('type' => 'root/relative/dir', …)`의 리터럴 쌍. PHP를 실행하지 않는다.
const SUBPLUGIN_PHP_RE = /'(\w+)'\s*=>\s*'([\w/-]+)'/g;
// 서브플러그인이 다시 서브플러그인을 선언하는 깊이의 상한. 실제 코드베이스는 2회면 고정점이다.
const MAX_ROUNDS = 3;
const YIELD_EVERY = 200;

interface RootInfo { types: Map<string, string>; subsystems: Map<string, string>; }

const cache = new Map<string, RootInfo>();
const inFlight = new Map<string, Promise<RootInfo>>();

export function clearPluginTypeCache(root?: string): void {
  if (root === undefined) { cache.clear(); inFlight.clear(); }
  else { cache.delete(root); inFlight.delete(root); }
}

/** 플러그인 타입 → 루트 기준 디렉터리. 루트별로 캐시한다 — 구성에 파일 탐색이 들어가고
 *  경로 역산이 워처 이벤트·정의 이동마다 이 맵을 부른다. */
export function pluginTypeDirs(root: string): Map<string, string> {
  return infoOf(root).types;
}

/** `lib/components.json`의 서브시스템 → 루트 기준 디렉터리. 코어 서브시스템은 컴포넌트명에서
 *  디렉터리를 유도할 수 없다(`core_form` → `lib/form`). 값이 null인 항목은 디렉터리가 없어 제외한다. */
export function coreSubsystemDirs(root: string): Map<string, string> {
  return infoOf(root).subsystems;
}

function infoOf(root: string): RootInfo {
  const hit = cache.get(root);
  if (hit) return hit;
  const info = buildSync(root);
  cache.set(root, info);
  return info;
}

function buildSync(root: string): RootInfo {
  const types = new Map(Object.entries(STATIC_PLUGIN_DIRS));
  const componentsText = readTextSync(path.join(root, 'lib', 'components.json'));
  const subsystems = parseSubsystems(componentsText);
  mergePluginTypes(types, componentsText);

  // 라운드마다 전체를 다시 훑으면 플러그인당 readdir와 파일 읽기가 헛돈다 —
  // 직전 라운드에서 새로 생긴 디렉터리만 본다.
  let frontier = [...new Set(types.values())];
  for (let round = 0; round < MAX_ROUNDS && frontier.length; round++) {
    const before = new Set(types.values());
    for (const dir of frontier) {
      for (const name of safeDirsSync(path.join(root, dir))) {
        const base = path.join(root, dir, name, 'db');
        const json = readTextSync(path.join(base, 'subplugins.json'));
        if (json !== null) { mergePluginTypes(types, json); continue; }
        mergePhpSubplugins(types, readTextSync(path.join(base, 'subplugins.php')));
      }
    }
    frontier = [...new Set(types.values())].filter(d => !before.has(d));
  }
  return { types, subsystems };
}

/** 동기판과 같은 규칙·같은 캐시. 진행 중 Promise를 공유해 동시 호출이 두 번 만들지 않는다. */
export function pluginTypeDirsAsync(root: string): Promise<Map<string, string>> {
  return rootInfoAsync(root).then(i => i.types);
}

export function coreSubsystemDirsAsync(root: string): Promise<Map<string, string>> {
  return rootInfoAsync(root).then(i => i.subsystems);
}

function rootInfoAsync(root: string): Promise<RootInfo> {
  const hit = cache.get(root);
  if (hit) return Promise.resolve(hit);
  const running = inFlight.get(root);
  if (running) return running;
  const p = buildAsync(root).then(info => {
    cache.set(root, info);
    inFlight.delete(root);
    return info;
  }, err => { inFlight.delete(root); throw err; });
  inFlight.set(root, p);
  return p;
}

async function buildAsync(root: string): Promise<RootInfo> {
  const types = new Map(Object.entries(STATIC_PLUGIN_DIRS));
  const componentsText = await readTextAsync(path.join(root, 'lib', 'components.json'));
  const subsystems = parseSubsystems(componentsText);
  mergePluginTypes(types, componentsText);

  let frontier = [...new Set(types.values())];
  let n = 0;
  for (let round = 0; round < MAX_ROUNDS && frontier.length; round++) {
    const before = new Set(types.values());
    for (const dir of frontier) {
      for (const name of await safeDirsAsync(path.join(root, dir))) {
        const base = path.join(root, dir, name, 'db');
        const json = await readTextAsync(path.join(base, 'subplugins.json'));
        if (json !== null) mergePluginTypes(types, json);
        else mergePhpSubplugins(types, await readTextAsync(path.join(base, 'subplugins.php')));
        if (++n % YIELD_EVERY === 0) await new Promise<void>(r => setImmediate(r));
      }
    }
    frontier = [...new Set(types.values())].filter(d => !before.has(d));
  }
  return { types, subsystems };
}

/** `components.json`과 `subplugins.json`이 같은 `plugintypes` 형태라 파서를 공유한다. */
function mergePluginTypes(map: Map<string, string>, text: string | null): void {
  if (text === null) return;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return; }
  const types = (raw as { plugintypes?: Record<string, unknown> })?.plugintypes;
  for (const [type, dir] of Object.entries(types ?? {})) {
    if (typeof dir === 'string' && dir) map.set(type, dir);
  }
}

function parseSubsystems(text: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (text === null) return out;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return out; }
  const subs = (raw as { subsystems?: Record<string, unknown> })?.subsystems;
  for (const [name, dir] of Object.entries(subs ?? {})) {
    if (typeof dir === 'string' && dir) out.set(name, dir);
  }
  return out;
}

/** `$subplugins` 첫 등장 위치부터만 훑는다 — 라이선스 헤더·docblock의 따옴표 쌍을 배제한다. */
function mergePhpSubplugins(map: Map<string, string>, text: string | null): void {
  if (text === null) return;
  const at = text.indexOf('$subplugins');
  if (at < 0) return;
  const body = text.slice(at);
  SUBPLUGIN_PHP_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SUBPLUGIN_PHP_RE.exec(body))) map.set(m[1], m[2]);
}

function readTextSync(file: string): string | null {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

async function readTextAsync(file: string): Promise<string | null> {
  try { return await fs.promises.readFile(file, 'utf8'); } catch { return null; }
}

/** 디렉터리(대상이 디렉터리인 심볼릭 링크 포함) 이름 목록 */
function safeDirsSync(dir: string): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries.filter(d => d.isDirectory() || (d.isSymbolicLink() && statIsDir(path.join(dir, d.name))))
    .map(d => d.name);
}

async function safeDirsAsync(dir: string): Promise<string[]> {
  let entries: fs.Dirent[];
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return []; }
  const out: string[] = [];
  for (const d of entries) {
    if (d.isDirectory()) { out.push(d.name); continue; }
    if (!d.isSymbolicLink()) continue;
    try { if ((await fs.promises.stat(path.join(dir, d.name))).isDirectory()) out.push(d.name); }
    catch { /* 깨진 링크 무시 */ }
  }
  return out;
}

function statIsDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
