import * as fs from 'fs';
import * as path from 'path';
import { ConfigKey, ConfigKeyRepository } from '../../domain/moodle-model/ports/config-key-repository';
import { pluginTypeDirsAsync } from '../workspace/plugin-type-map';
import { yieldNow, INDEX_YIELD_EVERY } from '../workspace/moodle-root-resolver';

// config-dist.php는 코어 $CFG 옵션을 대입문 형태로 문서화한다.
const CFG_ASSIGN_RE = /\$CFG->(\w+)\s*=/g;
// 관리 설정 선언. 이름이 `plugin/key`면 $CFG에 올라가는 것은 마지막 조각이다.
const ADMIN_SETTING_RE = /new\s+admin_setting_\w+\s*\(\s*'([\w/]+)'/g;

/** `$CFG->` 완성 후보 — config-dist.php와 설정 선언에서 모은다.
 *  런타임에 `set_config`로 만들어지는 키는 어디에도 선언되지 않아 담기지 않는다. */
export class ConfigKeyIndex implements ConfigKeyRepository {
  private byName = new Map<string, ConfigKey>();

  async buildFromRootAsync(root: string): Promise<void> {
    const map = new Map<string, ConfigKey>();
    await addFromDist(map, path.join(root, 'config-dist.php'));
    let n = 0;
    for (const file of await settingsFiles(root)) {
      await addFromSettings(map, file);
      if (++n % INDEX_YIELD_EVERY === 0) await yieldNow();
    }
    this.byName = map;
  }

  keys(): ConfigKey[] { return [...this.byName.values()]; }
  find(name: string): ConfigKey | undefined { return this.byName.get(name); }
}

/** `admin/settings/*.php`와 각 플러그인의 `settings.php` */
async function settingsFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const adminDir = path.join(root, 'admin', 'settings');
  try {
    for (const f of await fs.promises.readdir(adminDir)) {
      if (f.endsWith('.php')) out.push(path.join(adminDir, f));
    }
  } catch { /* 없는 버전 */ }
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

async function addFromDist(map: Map<string, ConfigKey>, file: string): Promise<void> {
  const text = await readText(file);
  if (text === null) return;
  collect(map, file, text, CFG_ASSIGN_RE, true);
}

async function addFromSettings(map: Map<string, ConfigKey>, file: string): Promise<void> {
  const text = await readText(file);
  if (text === null) return;
  collect(map, file, text, ADMIN_SETTING_RE, false);
}

/** 줄 번호는 매치마다 앞을 되짚지 않고 누적해서 센다. 먼저 찾은 선언을 유지한다. */
function collect(map: Map<string, ConfigKey>, file: string, text: string,
                 re: RegExp, withDoc: boolean): void {
  const lines = text.split(/\r?\n/);
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  let lastIdx = 0, line = 0, lineStart = 0;
  while ((m = re.exec(text))) {
    for (let i = lastIdx; i < m.index; i++) {
      if (text.charCodeAt(i) === 10) { line++; lineStart = i + 1; }
    }
    lastIdx = m.index;
    const raw = m[1];
    const name = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
    if (map.has(name)) continue;
    map.set(name, {
      name, doc: withDoc ? commentAbove(lines, line) : '',
      location: { uri: file, line, column: m.index - lineStart },
    });
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
