import { ConfigDeclaration } from '../../domain/moodle-model/ports/config-key-repository';
import { configPlugin } from '../../domain/moodle-model/services/config-plugin';

// 대입 한 문장: $v = 'lit'; | $v = "lit"; | $v = $u . '/k'; | $v = "$u/k"; | $v = "{$u}/k";
const ASSIGN = String.raw`\$(?<av>\w+)\s*=\s*(?:'(?<al>[\w/]+)'|"(?<al2>[\w/]+)"|\$(?<ab>\w+)\s*\.\s*'(?<as>/[\w/]+)'|"\$(?<ab2>\w+)(?<as2>/[\w/]+)"|"\{\$(?<ab3>\w+)\}(?<as3>/[\w/]+)")\s*;`;
// 선언의 첫 인자: 리터럴 | $u . '/k' | "$u/k" | $v   (new admin_setting[s]_*( 또는 parent::__construct( 뒤)
const DECL = String.raw`(?:new\s+(?<cls>admin_settings?_\w+)\s*\(|(?<ctor>parent::__construct)\s*\()\s*(?:'(?<dl>[\w/]+)'|"(?<dl2>[\w/]+)"|\$(?<db>\w+)\s*\.\s*'(?<ds>/[\w/]+)'|"\$(?<db2>\w+)(?<ds2>/[\w/]+)"|\$(?<dv>\w+)\b)`;
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
  let lastIdx = 0, line = 0, lineStart = 0; // 증분 라인 계산 — 매치마다 앞을 되짚지 않는다
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text))) {
    const g = m.groups as Groups;
    if (g.av !== undefined) { assign(vars, g); continue; }
    for (let i = lastIdx; i < m.index; i++) if (text.charCodeAt(i) === 10) { line++; lineStart = i + 1; }
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
    out.push({ plugin, key, settingClass, location: { uri: file, line, column: m.index - lineStart + argOffset } });
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
  if (g.db !== undefined || g.db2 !== undefined) {
    const base = vars.get((g.db ?? g.db2) as string);
    return base !== undefined ? base + (g.ds ?? g.ds2) : undefined;
  }
  return g.dv !== undefined ? vars.get(g.dv) : undefined;
}
