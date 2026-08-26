import * as fs from 'fs';
import * as path from 'path';
import { ConfigDeclaration, ConfigKey, ConfigKeyRepository } from '../../domain/moodle-model/ports/config-key-repository';
import { configKeyId, configPlugin } from '../../domain/moodle-model/services/config-plugin';
import { pluginTypeDirsAsync } from '../workspace/plugin-type-map';
import { yieldNow, INDEX_YIELD_EVERY, pluginTypeOfRel } from '../workspace/moodle-root-resolver';
import { parseSettingDeclarations } from './settings-declaration-parser';

// config-dist.php는 코어 $CFG 옵션을 대입문 형태로 문서화한다.
const CFG_ASSIGN_RE = /\$CFG->(\w+)\s*=/g;

interface Maps {
  /** `$CFG->` 완성용 납작한 이름 — 먼저 찾은 선언을 유지한다 */
  byName: Map<string, ConfigKey>;
  /** 'plugin/key' → 선언 */
  byId: Map<string, ConfigDeclaration>;
  byFile: Map<string, ConfigDeclaration[]>;
  byPlugin: Map<string, ConfigDeclaration[]>;
}
const emptyMaps = (): Maps => ({ byName: new Map(), byId: new Map(), byFile: new Map(), byPlugin: new Map() });

/** 설정 키 색인 — `$CFG->` 완성 후보(config-dist.php + 선언)와 플러그인 설정 선언((plugin, key) → settings.php 위치).
 *  런타임에 `set_config`로만 만들어지는 키는 어디에도 선언되지 않아 담기지 않는다.
 *  선언 맵들은 조립 함수 두 개(mergeFile·removeFileFrom)로만 바뀐다 — 전체 빌드와 파일 단위 증분이 갈라질 수 없다
 *  (config-dist.php는 선언이 아니라 납작한 이름에만 들어가며 전체 빌드에서만 읽는다). */
export class ConfigKeyIndex implements ConfigKeyRepository {
  private maps = emptyMaps();

  async buildFromRootAsync(root: string): Promise<void> {
    const next = emptyMaps();
    await addFromDist(next.byName, path.join(root, 'config-dist.php'));
    let n = 0;
    for (const file of await settingsFiles(root)) {
      mergeFile(next, file, await readText(file));
      if (++n % INDEX_YIELD_EVERY === 0) await yieldNow();
    }
    this.maps = next; // 한 번에 교체 — 빌드 중 조회가 반쪽 색인을 보지 않는다
  }

  /** 그 파일의 항목만 교체. 납작 맵에서 다른 파일이 먼저 선언한 같은 이름은 그대로 남는다. */
  async updateFile(file: string): Promise<void> {
    removeFileFrom(this.maps, file);
    mergeFile(this.maps, file, await readText(file));
  }

  removeFile(file: string): void { removeFileFrom(this.maps, file); }

  keys(): ConfigKey[] { return [...this.maps.byName.values()]; }
  find(name: string): ConfigKey | undefined { return this.maps.byName.get(name); }
  declaration(plugin: string, key: string): ConfigDeclaration | undefined { return this.maps.byId.get(configKeyId(plugin, key)); }
  declarationsIn(file: string): ConfigDeclaration[] { return this.maps.byFile.get(file) ?? []; }
  keysOfPlugin(plugin: string): ConfigDeclaration[] { return this.maps.byPlugin.get(configPlugin(plugin)) ?? []; }
}

/** 선언 색인이 열거하는 파일인가 — 워처가 색인 규칙 밖의 `settings.php`(클래스 파일 등)로 증분을 넣지 않게 한다. */
export function isDeclarationFile(root: string, fsPath: string): boolean {
  const rel = path.relative(root, fsPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const parts = rel.split(path.sep);
  if (parts.length === 2 && parts[0] === 'lib' && parts[1] === 'adminlib.php') return true;
  if (parts.length === 3 && parts[0] === 'admin' && parts[1] === 'settings' && parts[2].endsWith('.php')) return true;
  return pluginTypeOfRel(root, rel)?.rest === 'settings.php';
}

/** `admin/settings/*.php`, 코어 특수 설정 클래스가 있는 `lib/adminlib.php`, 각 플러그인의 `settings.php` */
async function settingsFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const adminDir = path.join(root, 'admin', 'settings');
  try {
    for (const f of await fs.promises.readdir(adminDir)) {
      if (f.endsWith('.php')) out.push(path.join(adminDir, f));
    }
  } catch { /* 없는 버전 */ }
  out.push(path.join(root, 'lib', 'adminlib.php'));
  for (const relDir of new Set((await pluginTypeDirsAsync(root)).values())) {
    const typeDir = path.join(root, relDir);
    let names: fs.Dirent[];
    try { names = await fs.promises.readdir(typeDir, { withFileTypes: true }); } catch { continue; }
    for (const d of names) {
      if (!d.isDirectory() && !d.isSymbolicLink()) continue;
      out.push(path.join(typeDir, d.name, 'settings.php'));
    }
  }
  return out;
}

function mergeFile(maps: Maps, file: string, text: string | null): void {
  if (text === null) return;
  const decls = parseSettingDeclarations(file, text);
  if (!decls.length) return;
  maps.byFile.set(file, decls);
  for (const d of decls) {
    const id = `${d.plugin}/${d.key}`;
    if (!maps.byId.has(id)) maps.byId.set(id, d);
    let list = maps.byPlugin.get(d.plugin);
    if (!list) { list = []; maps.byPlugin.set(d.plugin, list); }
    list.push(d);
    if (!maps.byName.has(d.key)) maps.byName.set(d.key, { name: d.key, doc: '', location: d.location });
  }
}

function removeFileFrom(maps: Maps, file: string): void {
  const decls = maps.byFile.get(file);
  if (!decls) return;
  maps.byFile.delete(file);
  for (const d of decls) {
    const id = `${d.plugin}/${d.key}`;
    if (maps.byId.get(id) === d) maps.byId.delete(id);
    const list = maps.byPlugin.get(d.plugin);
    if (list) {
      const rest = list.filter(x => x !== d);
      if (rest.length) maps.byPlugin.set(d.plugin, rest); else maps.byPlugin.delete(d.plugin);
    }
    if (maps.byName.get(d.key)?.location.uri === file) maps.byName.delete(d.key);
  }
}

async function addFromDist(map: Map<string, ConfigKey>, file: string): Promise<void> {
  const text = await readText(file);
  if (text === null) return;
  const lines = text.split(/\r?\n/);
  CFG_ASSIGN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let lastIdx = 0, line = 0, lineStart = 0; // 줄 번호는 매치마다 앞을 되짚지 않고 누적해서 센다
  while ((m = CFG_ASSIGN_RE.exec(text))) {
    for (let i = lastIdx; i < m.index; i++) {
      if (text.charCodeAt(i) === 10) { line++; lineStart = i + 1; }
    }
    lastIdx = m.index;
    const name = m[1];
    if (map.has(name)) continue;
    map.set(name, { name, doc: commentAbove(lines, line), location: { uri: file, line, column: m.index - lineStart } });
  }
}

/** 대입 바로 위의 `//` 주석 줄들을 설명으로 쓴다(config-dist의 관례). */
function commentAbove(lines: string[], line: number): string {
  const out: string[] = [];
  for (let i = line - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (!t.startsWith('//')) break;
    out.unshift(t.replace(/^\/\/\s?/, ''));
  }
  return out.join(' ').trim();
}

async function readText(file: string): Promise<string | null> {
  try { return await fs.promises.readFile(file, 'utf8'); } catch { return null; }
}
