import { ConfigDeclaration } from '../../domain/moodle-model/ports/config-key-repository';
import { configPlugin } from '../../domain/moodle-model/services/config-plugin';

// 대입 한 문장: $v = 'lit'; | $v = "lit"; | $v = $u . '/k'; | $v = "$u/k"; | $v = "{$u}/k";
// 그 밖의 모든 대입(`$v = f();`·`$v = 'p/' . $key;` …)은 마지막 대안이 잡아 값을 지운다 — 이전 값이 남으면 다음 선언이 옛 키가 된다.
const ASSIGN = String.raw`\$(?<av>\w+)\s*=\s*(?:'(?<al>[\w/]+)'|"(?<al2>[\w/]+)"|\$(?<ab>\w+)\s*\.\s*'(?<as>/[\w/]+)'|"\$(?<ab2>\w+)(?<as2>/[\w/]+)"|"\{\$(?<ab3>\w+)\}(?<as3>/[\w/]+)")\s*;|\$(?<au>\w+)\s*=(?!=)`;
// 선언의 첫 인자: 리터럴 | $u . '/k' | "$u/k" | "{$u}/k" | $v(인자 전체가 변수일 때만 — 실패한 연결식의 앞머리를 잡지 않게)
const DECL = String.raw`(?:new\s+(?<cls>admin_settings?_\w+)\s*\(|(?<ctor>parent::__construct)\s*\()\s*(?:'(?<dl>[\w/]+)'|"(?<dl2>[\w/]+)"|\$(?<db>\w+)\s*\.\s*'(?<ds>/[\w/]+)'|"\$(?<db2>\w+)(?<ds2>/[\w/]+)"|"\{\$(?<db3>\w+)\}(?<ds3>/[\w/]+)"|\$(?<dv>\w+)\s*(?=[,)]))`;
const TOKEN_RE = new RegExp(`${ASSIGN}|${DECL}`, 'g');

type Groups = Record<string, string | undefined>;

/** settings.php에서 `admin_setting_*` 선언을 (plugin, key)로 뽑는다.
 *  선언 이름이 변수를 거치는 관용구(`$name = $pluginname . '/key'; new admin_setting_configtext($name, …)`)를
 *  등장 순서대로 따라간다 — 같은 변수에 반복 대입하므로 가장 가까운 선행 대입이 값이다.
 *  값을 모르는 변수·heading은 선언으로 보지 않는다. 슬래시 없는 이름은 core. */
export function parseSettingDeclarations(file: string, text: string): ConfigDeclaration[] {
  const out: ConfigDeclaration[] = [];
  const seen = new Set<string>();
  const vars = new Map<string, string>();
  const source = blankComments(text);
  let lastIdx = 0, line = 0, lineStart = 0; // 증분 라인 계산 — 매치마다 앞을 되짚지 않는다
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(source))) {
    const g = m.groups as Groups;
    if (g.au !== undefined) { vars.delete(g.au); continue; }
    if (g.av !== undefined) { assign(vars, g); continue; }
    for (let i = lastIdx; i < m.index; i++) if (source.charCodeAt(i) === 10) { line++; lineStart = i + 1; }
    lastIdx = m.index;
    const raw = declaredName(g, vars);
    if (raw === undefined) continue;
    const settingClass = g.cls ?? 'admin_setting';
    if (settingClass === 'admin_setting_heading') continue; // 제목 — 값이 없다
    const slash = raw.indexOf('/');
    const plugin = slash < 0 ? 'core' : configPlugin(raw.slice(0, slash));
    const key = slash < 0 ? raw : raw.slice(slash + 1);
    if (!key) continue;
    const id = `${plugin}/${key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const open = m[0].indexOf('(');
    const argOffset = open + 1 + m[0].slice(open + 1).search(/\S/);
    // 첫 인자가 다음 줄에 있으면 그 줄·컬럼을 가리킨다
    let argLine = line, argLineStart = lineStart;
    for (let i = 0; i < argOffset; i++) if (m[0].charCodeAt(i) === 10) { argLine++; argLineStart = m.index + i + 1; }
    out.push({ plugin, key, settingClass, location: { uri: file, line: argLine, column: m.index + argOffset - argLineStart } });
  }
  return out;
}

function assign(vars: Map<string, string>, g: Groups): void {
  const name = g.av as string;
  const lit = g.al ?? g.al2;
  if (lit !== undefined) { vars.set(name, lit); return; }
  const base = vars.get((g.ab ?? g.ab2 ?? g.ab3) as string);
  const suffix = g.as ?? g.as2 ?? g.as3;
  if (base !== undefined && suffix !== undefined) vars.set(name, base + suffix);
  else vars.delete(name); // 모르는 값 — 이전 값을 남기면 다음 선언이 엉뚱한 키가 된다
}

function declaredName(g: Groups, vars: Map<string, string>): string | undefined {
  if (g.dl !== undefined || g.dl2 !== undefined) return g.dl ?? g.dl2;
  const base = g.db ?? g.db2 ?? g.db3;
  if (base !== undefined) {
    const value = vars.get(base);
    return value !== undefined ? value + (g.ds ?? g.ds2 ?? g.ds3) : undefined;
  }
  return g.dv !== undefined ? vars.get(g.dv) : undefined;
}

/** 주석을 같은 길이의 공백으로 바꾼다(줄·오프셋 유지) — 주석 처리된 선언이 살아 있는 선언으로 보이지 않게. */
function blankComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*(?:\/\/|#).*$/gm, m => m.replace(/[^\n]/g, ' '));
}
