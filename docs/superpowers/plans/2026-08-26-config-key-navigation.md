# 플러그인 설정 키(get_config) 탐색 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `get_config('p','k')`·`set_config('k', v, 'p')`의 키에서 settings.php 선언으로 F12·hover·하이라이팅, 코드↔선언 양방향 Shift+F12, settings.php 선언 줄 "사용 N건" CodeLens·hover 링크, 키 완성.

**Architecture:** 문자열 표면의 구조를 그대로 옮긴다 — 선언 색인(`ConfigKeyIndex`를 (plugin, key) 쌍으로 확장 + 순차 대입을 따라가는 settings.php 파서), 팩트(tree-sitter 쿼리 4개), 사용처 색인(`PhpUsageIndex`에 종류 추가), 유스케이스, 얇은 프로바이더. 0.15.0의 문자열 전용 참조 프로바이더·CodeLens·hover 링크·명령을 **대상 타입에 일반화**해 두 표면이 공유한다.

**Tech Stack:** TypeScript, web-tree-sitter(PHP WASM), mocha + ts-node, VS Code API.

**Spec:** `docs/superpowers/specs/2026-08-26-config-key-navigation-design.md` — 충돌 시 스펙이 우선.

## Global Constraints

- 계층 규칙(eslint 강제): `domain/`은 fs·path·vscode·infrastructure·presentation 금지, `application/`은 infrastructure·presentation·vscode 금지. presentation은 infrastructure를 import하지 않는다(컴포지션 루트가 주입).
- 설정의 plugin은 **그대로 비교**(정규화 없음). `''`·`moodle`·`core`(슬래시 없는 선언)만 `core`.
- 해석되지 않는 것에는 아무 반응도 하지 않는다. **진단은 비목표.**
- 선언 색인은 활성화에 넣지 않는다(lazy) — 전역 핸들과 빌드 Promise를 공유한다.
- 주석은 객관적으로만(날짜·리뷰·백로그 번호 금지).
- 픽스처는 `test/fixtures/mini-moodle`. 기존 436건 무회귀. 각 Task 끝에 `npm run test:unit`·`npm run compile`·`npm run lint` 녹색.
- 라벨은 문자열과 같다: "사용 N건" / 색인 전 "사용 찾기" / hover "사용 N건 보기".

---

### Task 1: 도메인 — 설정 팩트·포트·플러그인 규칙·전파 타입

**Files:**
- Modify: `src/domain/code-analysis/facts.ts`
- Modify: `src/domain/lang-model/services/component-propagation.ts:5`
- Create: `src/domain/moodle-model/services/config-plugin.ts`
- Create: `src/domain/code-analysis/config-functions.ts`
- Modify: `src/domain/moodle-model/ports/config-key-repository.ts`
- Create: `src/domain/moodle-model/ports/config-usage-repository.ts`
- Test: `test/unit/domain/config-plugin.test.ts`

**Interfaces (Produces):**
```ts
// facts.ts
export interface ConfigCall { plugin: string; key: string; kind: 'get' | 'set'; keyLine: number; keyColumn: number; keyIndex: number; index: number; }
export interface DynamicConfigCall { key: string; comp: ComponentRef; kind: 'get' | 'set'; keyLine: number; keyColumn: number; keyIndex: number; index: number; scope: Scope; }
export interface ComponentRefSite { comp: ComponentRef; index: number; scope: Scope; }
DocumentFacts.configCalls: ConfigCall[]; DocumentFacts.dynamicConfigCalls: DynamicConfigCall[];
// component-propagation.ts
export function resolveComponentRef(facts: DocumentFacts, call: ComponentRefSite): string | null
// config-plugin.ts
export function configPlugin(raw: string): string          // ''|moodle|core → core, 그 외 그대로
export function configKeyId(plugin: string, key: string): string  // `${configPlugin(plugin)}/${key}`
// config-functions.ts
export function configFunctionKind(name: string): 'get' | 'set' | undefined   // get_config→get, set_config→set
// config-key-repository.ts
export interface ConfigDeclaration { plugin: string; key: string; settingClass: string; location: SourceLocation; }
export interface ConfigKeyRepository { keys(); find(name); declaration(plugin, key): ConfigDeclaration | undefined; declarationsIn(file: string): ConfigDeclaration[]; keysOfPlugin(plugin: string): ConfigDeclaration[]; }
// config-usage-repository.ts
export interface ConfigUsageRepository { configRefsOf(plugin: string, key: string): SourceLocation[]; }
```

- [ ] **Step 1: 실패하는 테스트** — `test/unit/domain/config-plugin.test.ts`

```ts
import { strict as assert } from 'assert';
import { configPlugin, configKeyId } from '../../../src/domain/moodle-model/services/config-plugin';

describe('configPlugin — 설정 plugin은 저장 키 그대로', () => {
  it("''·moodle·core → core", () => {
    for (const r of ['', 'moodle', 'core']) assert.equal(configPlugin(r), 'core');
  });
  it('bare 이름도 그대로 — ubboard와 mod_ubboard는 다른 행', () => {
    assert.equal(configPlugin('ubboard'), 'ubboard');
    assert.equal(configPlugin('mod_ubboard'), 'mod_ubboard');
  });
  it('configKeyId는 plugin/key', () => assert.equal(configKeyId('moodle', 'x'), 'core/x'));
});
```

- [ ] **Step 2: RED 확인** — `npx mocha --no-config -r ts-node/register test/unit/domain/config-plugin.test.ts` → 모듈 없음.

- [ ] **Step 3: 구현**

`config-plugin.ts`:
```ts
/** 설정의 plugin은 config_plugins의 저장 키 그 자체라 정규화하지 않는다 — `ubboard`와 `mod_ubboard`는 다른 행이다.
 *  Moodle의 get_config·admin_setting이 `$CFG`로 보내는 별칭만 core로 접는다. */
export function configPlugin(raw: string): string {
  return raw === '' || raw === 'moodle' || raw === 'core' ? 'core' : raw;
}
/** 선언 색인·사용처 색인이 함께 쓰는 키 */
export function configKeyId(plugin: string, key: string): string {
  return `${configPlugin(plugin)}/${key}`;
}
```
`config-functions.ts`:
```ts
/** 플러그인 설정을 읽고 쓰는 함수. get_config(plugin, key) / set_config(key, value, plugin) — 인자 자리가 다르다. */
const KINDS: ReadonlyMap<string, 'get' | 'set'> = new Map([['get_config', 'get'], ['set_config', 'set']]);
export function configFunctionKind(name: string): 'get' | 'set' | undefined { return KINDS.get(name); }
```
`facts.ts`: 위 인터페이스 세 개 추가(`TableRef` 아래), `DocumentFacts`에 `configCalls`·`dynamicConfigCalls`, `emptyFacts`에 `configCalls: [], dynamicConfigCalls: []`.
`component-propagation.ts`: import에서 `DynamicStringCall` → `ComponentRefSite`, 시그니처 `call: ComponentRefSite`.
`config-key-repository.ts`: `ConfigDeclaration` 추가, 인터페이스에 세 메서드 추가.
`config-usage-repository.ts`:
```ts
import { SourceLocation } from '../../shared/value-objects';
export interface ConfigUsageRepository { configRefsOf(plugin: string, key: string): SourceLocation[]; }
```

- [ ] **Step 4: 컴파일** — `npm run compile`. `ConfigKeyRepository`를 구현하는 곳(`ConfigKeyIndex`, 테스트의 fake)이 새 메서드 때문에 실패하면 Task 3에서 채우기 전까지 `declaration: () => undefined, declarationsIn: () => [], keysOfPlugin: () => []`를 임시로 넣지 말고 **Task 3까지 컴파일 실패를 허용**하지 않는다 — Task 1에서는 `ConfigKeyIndex`에 세 메서드를 최소 구현(빈 결과)으로 먼저 추가한다.
- [ ] **Step 5: GREEN** — `npm run test:unit` 437 통과. 커밋 `feat(domain): 설정 호출 팩트·선언/사용처 포트·plugin 규칙`.

---

### Task 2: settings.php 선언 파서 (순수 함수)

**Files:**
- Create: `src/infrastructure/config/settings-declaration-parser.ts`
- Test: `test/unit/infra/settings-declaration-parser.test.ts`

**Interfaces:**
- Produces: `parseSettingDeclarations(file: string, text: string): ConfigDeclaration[]`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { strict as assert } from 'assert';
import { parseSettingDeclarations } from '../../../src/infrastructure/config/settings-declaration-parser';

const TEXT = `<?php
$pluginname = 'local_csmsmedia';
$settings->add(new admin_setting_configtext('local_csmsmedia/uploadurl', 'a', 'b', ''));
$name = $pluginname . '/organization_code';
$title = get_string('organization_code', $pluginname);
$setting = new admin_setting_configtext($name, $title, '', '');
$name = 'local_csmsmedia/drm_site_id';
$setting = new admin_setting_configpasswordunmask($name, $title, '', '');
$name = "$pluginname/token";
$setting = new admin_setting_configtext($name, $title, '', '');
$setting = new admin_setting_configcheckbox($pluginname . '/enabled', $title, '', 0);
$settings->add(new admin_setting_heading('local_csmsmedia/head', 'h', ''));
$settings->add(new admin_setting_configselect('sitepolicy', 'x', 'y', 0, []));
$temp->add(new admin_settings_num_course_sections('moodlecourse/numsections', 'n', 'd', 4));
$unknown = some_function();
$setting = new admin_setting_configtext($unknown, $title, '', '');
class special extends admin_setting_configmulticheckbox {
  public function __construct() { parent::__construct('gradebookroles', 'x', 'y', null, null); }
}
`;

describe('parseSettingDeclarations — settings.php 관용구', () => {
  const decls = parseSettingDeclarations('/m/local/csmsmedia/settings.php', TEXT);
  const byKey = (k: string) => decls.find(d => d.key === k);

  it('리터럴 plugin/key', () => {
    assert.deepEqual({ ...byKey('uploadurl')!, location: undefined },
      { plugin: 'local_csmsmedia', key: 'uploadurl', settingClass: 'admin_setting_configtext', location: undefined });
  });
  it('$name = $pluginname . "/key" 연결 대입을 따라간다', () =>
    assert.equal(byKey('organization_code')?.plugin, 'local_csmsmedia'));
  it('$name = "p/k" 리터럴 재대입 — 가장 가까운 선행 대입', () =>
    assert.equal(byKey('drm_site_id')?.settingClass, 'admin_setting_configpasswordunmask'));
  it('"$pluginname/token" 보간', () => assert.equal(byKey('token')?.plugin, 'local_csmsmedia'));
  it('첫 인자에 바로 쓴 연결 $pluginname . "/enabled"', () => assert.equal(byKey('enabled')?.plugin, 'local_csmsmedia'));
  it('heading은 값이 없어 제외', () => assert.equal(byKey('head'), undefined));
  it('슬래시 없는 이름은 core', () => assert.equal(byKey('sitepolicy')?.plugin, 'core'));
  it('복수형 클래스명(admin_settings_*)도 선언', () =>
    assert.equal(byKey('numsections')?.settingClass, 'admin_settings_num_course_sections'));
  it('값을 모르는 변수는 침묵', () => assert.equal(decls.filter(d => d.plugin === 'core').length, 2, 'sitepolicy·gradebookroles만'));
  it('parent::__construct 리터럴은 core 선언', () => assert.equal(byKey('gradebookroles')?.plugin, 'core'));
  it('위치는 new 줄과 첫 인자 컬럼', () => {
    const d = byKey('organization_code')!;
    const line = TEXT.split('\n')[d.location.line];
    assert.match(line, /new admin_setting_configtext\(\$name/);
    assert.equal(line.slice(d.location.column, d.location.column + 5), '$name');
    assert.equal(d.location.uri, '/m/local/csmsmedia/settings.php');
  });
  it('같은 (plugin, key)가 두 번이면 먼저 것', () => {
    const two = parseSettingDeclarations('/f', "<?php\nnew admin_setting_configtext('a/k', '', '', '');\nnew admin_setting_configselect('a/k', '', '', 0, []);\n");
    assert.equal(two.length, 1); assert.equal(two[0].settingClass, 'admin_setting_configtext');
  });
});
```

- [ ] **Step 2: RED 확인.**
- [ ] **Step 3: 구현**

```ts
import { ConfigDeclaration } from '../../domain/moodle-model/ports/config-key-repository';
import { configPlugin } from '../../domain/moodle-model/services/config-plugin';

// 대입 한 문장: $v = 'lit'; | $v = "lit"; | $v = $u . '/k'; | $v = "$u/k"; | $v = "{$u}/k";
const ASSIGN = String.raw`\$(?<av>\w+)\s*=\s*(?:'(?<al>[\w/]+)'|"(?<al2>[\w/]+)"|\$(?<ab>\w+)\s*\.\s*'(?<as>/[\w/]+)'|"\$(?<ab2>\w+)(?<as2>/[\w/]+)"|"\{\$(?<ab3>\w+)\}(?<as3>/[\w/]+)")\s*;`;
// 선언의 첫 인자: 리터럴 | $u . '/k' | "$u/k" | $v   (new admin_setting[s]_*( 또는 parent::__construct( 뒤)
const DECL = String.raw`(?:new\s+(?<cls>admin_settings?_\w+)\s*\(|(?<ctor>parent::__construct)\s*\()\s*(?:'(?<dl>[\w/]+)'|"(?<dl2>[\w/]+)"|\$(?<db>\w+)\s*\.\s*'(?<ds>/[\w/]+)'|"\$(?<db2>\w+)(?<ds2>/[\w/]+)"|\$(?<dv>\w+)\b)`;
const TOKEN_RE = new RegExp(`${ASSIGN}|${DECL}`, 'g');

/** settings.php에서 `admin_setting_*` 선언을 (plugin, key)로 뽑는다.
 *  선언 이름이 변수를 거치는 관용구(`$name = $pluginname . '/key'; new admin_setting_configtext($name, …)`)를
 *  등장 순서대로 따라간다 — 같은 변수에 반복 대입하므로 가장 가까운 선행 대입이 값이다.
 *  값을 모르는 변수·heading은 선언으로 보지 않는다. 슬래시 없는 이름은 core. */
export function parseSettingDeclarations(file: string, text: string): ConfigDeclaration[] {
  const out: ConfigDeclaration[] = [];
  const seen = new Set<string>();
  const vars = new Map<string, string>();
  let lastIdx = 0, line = 0, lineStart = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text))) {
    const g = m.groups!;
    if (g.av !== undefined) { assign(vars, g); continue; }
    for (let i = lastIdx; i < m.index; i++) if (text.charCodeAt(i) === 10) { line++; lineStart = i + 1; }
    lastIdx = m.index;
    const raw = declaredName(g, vars);
    if (raw === undefined) continue;
    const settingClass = g.cls ?? 'admin_setting';
    if (settingClass === 'admin_setting_heading') continue;
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

function assign(vars: Map<string, string>, g: Record<string, string | undefined>): void {
  const lit = g.al ?? g.al2;
  if (lit !== undefined) { vars.set(g.av!, lit); return; }
  const base = vars.get((g.ab ?? g.ab2 ?? g.ab3)!);
  const suffix = g.as ?? g.as2 ?? g.as3;
  if (base !== undefined && suffix !== undefined) vars.set(g.av!, base + suffix);
  else vars.delete(g.av!); // 모르는 값 — 이전 값을 남기면 다음 선언이 엉뚱한 키가 된다
}

function declaredName(g: Record<string, string | undefined>, vars: Map<string, string>): string | undefined {
  if (g.dl !== undefined || g.dl2 !== undefined) return g.dl ?? g.dl2;
  if (g.db !== undefined || g.db2 !== undefined) {
    const base = vars.get((g.db ?? g.db2)!);
    return base !== undefined ? base + (g.ds ?? g.ds2) : undefined;
  }
  return g.dv !== undefined ? vars.get(g.dv) : undefined;
}
```

- [ ] **Step 4: GREEN.** 커밋 `feat(infra): settings.php 선언 파서 — 순차 대입 관용구 추적`.

---

### Task 3: ConfigKeyIndex 확장 + 픽스처

**Files:**
- Modify: `src/infrastructure/config/config-key-index.ts`
- Modify(픽스처): `test/fixtures/mini-moodle/local/ubattend/settings.php`
- Create(픽스처): `test/fixtures/mini-moodle/lib/adminlib.php`
- Test: `test/unit/infra/config-key-index.test.ts`

**Interfaces:**
- Consumes: `parseSettingDeclarations`, `ConfigDeclaration`.
- Produces: `ConfigKeyIndex.declaration(plugin, key)`, `.declarationsIn(file)`, `.keysOfPlugin(plugin)`, `.updateFile(file): Promise<void>`, `.removeFile(file): void`. 기존 `keys()`·`find()`·`buildFromRootAsync()` 유지.

- [ ] **Step 1: 픽스처**

`local/ubattend/settings.php`에 추가:
```php
$pluginname = 'local_ubattend';
$name = $pluginname . '/apikey';
$settings->add(new admin_setting_configtext($name, 'API 키', '', ''));
$name = 'local_ubattend/mode';
$settings->add(new admin_setting_configselect($name, '모드', '', 0, []));
$settings->add(new admin_setting_heading('local_ubattend/head', '제목', ''));
```
`lib/adminlib.php`:
```php
<?php
class admin_setting_special_gradebookroles extends admin_setting_configmulticheckbox {
    public function __construct() {
        parent::__construct('gradebookroles', 'x', 'y', null, null);
    }
}
```

- [ ] **Step 2: 실패하는 테스트** — `config-key-index.test.ts`에 추가

```ts
  const settingsFile = join(root, 'local/ubattend/settings.php');
  it('(plugin, key) 선언 — 리터럴·$name 연결·$name 리터럴', () => {
    assert.equal(idx.declaration('local_ubattend', 'attendlimit')?.settingClass, 'admin_setting_configtext');
    assert.equal(idx.declaration('local_ubattend', 'apikey')?.settingClass, 'admin_setting_configtext');
    assert.equal(idx.declaration('local_ubattend', 'mode')?.settingClass, 'admin_setting_configselect');
    assert.equal(idx.declaration('local_ubattend', 'head'), undefined, 'heading 제외');
    assert.equal(idx.declaration('mod_ubattend', 'apikey'), undefined, '플러그인은 그대로 비교');
  });
  it('lib/adminlib.php의 parent::__construct → core', () =>
    assert.equal(idx.declaration('core', 'gradebookroles')?.plugin, 'core'));
  it('declarationsIn: 파일의 선언(슬래시 없는 것은 core로)', () => {
    const ds = idx.declarationsIn(settingsFile);
    assert.deepEqual(ds.map(d => `${d.plugin}/${d.key}`).sort(),
      ['core/ubattend_simple', 'local_ubattend/apikey', 'local_ubattend/attendlimit', 'local_ubattend/mode']);
    assert.ok(ds.every(d => d.location.uri === settingsFile));
  });
  it('keysOfPlugin: 그 플러그인만', () =>
    assert.deepEqual(idx.keysOfPlugin('local_ubattend').map(d => d.key).sort(), ['apikey', 'attendlimit', 'mode']));
  it('removeFile → 사라지고, updateFile → 돌아온다($CFG-> 납작 맵도 함께)', async () => {
    idx.removeFile(settingsFile);
    assert.equal(idx.declaration('local_ubattend', 'apikey'), undefined);
    assert.equal(idx.find('attendlimit'), undefined);
    await idx.updateFile(settingsFile);
    assert.ok(idx.declaration('local_ubattend', 'apikey'));
    assert.ok(idx.find('attendlimit'));
    assert.ok(idx.find('wwwroot'), 'config-dist는 영향 없음');
  });
```
기존 테스트 `find('attendlimit')`·`find('local_ubattend/attendlimit') === undefined`·`keys()` 중복 없음은 그대로 통과해야 한다.

- [ ] **Step 3: RED 확인.**
- [ ] **Step 4: 구현** — 자료구조를 하나의 `Maps`로 묶고 조립 함수 두 개(`mergeFile`·`removeFileFrom`)만 그것을 바꾼다.

```ts
interface Maps {
  byName: Map<string, ConfigKey>;                 // $CFG-> 완성용 납작한 이름 — 먼저 찾은 선언 유지
  byId: Map<string, ConfigDeclaration>;           // 'plugin/key'
  byFile: Map<string, ConfigDeclaration[]>;
  byPlugin: Map<string, ConfigDeclaration[]>;
}
const emptyMaps = (): Maps => ({ byName: new Map(), byId: new Map(), byFile: new Map(), byPlugin: new Map() });

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
  async updateFile(file: string): Promise<void> { removeFileFrom(this.maps, file); mergeFile(this.maps, file, await readText(file)); }
  removeFile(file: string): void { removeFileFrom(this.maps, file); }

  keys(): ConfigKey[] { return [...this.maps.byName.values()]; }
  find(name: string): ConfigKey | undefined { return this.maps.byName.get(name); }
  declaration(plugin: string, key: string): ConfigDeclaration | undefined { return this.maps.byId.get(configKeyId(plugin, key)); }
  declarationsIn(file: string): ConfigDeclaration[] { return this.maps.byFile.get(file) ?? []; }
  keysOfPlugin(plugin: string): ConfigDeclaration[] { return this.maps.byPlugin.get(configPlugin(plugin)) ?? []; }
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
    if (list) { const rest = list.filter(x => x !== d); if (rest.length) maps.byPlugin.set(d.plugin, rest); else maps.byPlugin.delete(d.plugin); }
    if (maps.byName.get(d.key)?.location.uri === file) maps.byName.delete(d.key);
  }
}
```
`settingsFiles()`에 `out.push(path.join(root, 'lib', 'adminlib.php'));`를 `admin/settings` 처리 뒤에 추가. 기존 `ADMIN_SETTING_RE`·`addFromSettings`·`collect`의 settings 분기는 제거하고 `collect`는 `config-dist`용으로만 남긴다(`withDoc` 매개변수 삭제).

- [ ] **Step 5: GREEN** (기존 config-key-index 테스트 포함). 커밋 `feat(infra): ConfigKeyIndex를 (plugin, key) 선언 색인으로 확장 + 파일 단위 증분`.

---

### Task 4: tree-sitter 팩트 — get_config/set_config(리터럴·동적)

**Files:**
- Modify: `src/infrastructure/tree-sitter/tree-sitter-php-syntax.ts`
- Test: `test/unit/infra/tree-sitter.test.ts`

- [ ] **Step 1: 실패하는 테스트**

```ts
describe('TreeSitterPhpSyntax — 설정 호출', () => {
  const CODE = `<?php
class y {
  public $pluginname = 'local_ubattend';
  function f() {
    $a = get_config('local_ubattend', 'apikey');
    set_config('mode', 1, 'local_ubattend');
    set_config('arr', ['a' => 1], 'local_ubattend');
    $b = get_config($this->pluginname, 'dyn');
    set_config('dyn2', $b, $this->pluginname);
    $c = get_config('local_ubattend');
    $d = get_config('local_ubattend', $k);
    echo get_string('apikey', 'local_ubattend');
  }
}
`;
  let f: any;
  before(async () => { f = (await TreeSitterPhpSyntax.create()).facts(CODE); });

  it('get_config(plugin, key) → get, set_config(key, value, plugin) → set(값이 배열이어도)', () => {
    assert.deepEqual(f.configCalls.map((c: any) => `${c.kind}:${c.plugin}/${c.key}`).sort(),
      ['get:local_ubattend/apikey', 'set:local_ubattend/arr', 'set:local_ubattend/mode']);
    const mode = f.configCalls.find((c: any) => c.key === 'mode');
    assert.equal(mode.keyIndex, CODE.indexOf("'mode'") + 1);
  });
  it('플러그인이 $this->프로퍼티면 dynamicConfigCalls', () => {
    assert.deepEqual(f.dynamicConfigCalls.map((c: any) => `${c.kind}:${c.key}:${c.comp.kind}:${c.comp.name}`).sort(),
      ['get:dyn:prop:pluginname', 'set:dyn2:prop:pluginname']);
  });
  it('한 인자·동적 키는 팩트 없음, get_string은 설정 호출이 아니다', () => {
    assert.ok(!f.configCalls.some((c: any) => c.key === 'local_ubattend'));
    assert.ok(!f.stringCalls.some((c: any) => c.key === 'apikey' && c.component === 'local_ubattend' && f.configCalls.includes(c)));
    assert.equal(f.stringCalls.filter((c: any) => c.key === 'apikey').length, 1, 'get_string만');
  });
});
```

- [ ] **Step 2: RED 확인.**
- [ ] **Step 3: 구현** — 쿼리 4개와 추출.

```ts
// get_config('plugin', 'key') / set_config('key', value, 'plugin') — 플러그인이 리터럴
const Q_CONFIG_GET = `
  (function_call_expression function: (name) @fn arguments: (arguments
    . (argument (string (string_content) @plugin)) . (argument (string (string_content) @key))))`;
const Q_CONFIG_SET = `
  (function_call_expression function: (name) @fn arguments: (arguments
    . (argument (string (string_content) @key)) . (argument) . (argument (string (string_content) @plugin))))`;
// 플러그인 인자가 변수·$this->프로퍼티·클래스 상수 — 문자열의 동적 컴포넌트와 같은 세 형태
const DYN_ARG = `[(variable_name (name) @var) (member_access_expression object: (variable_name) @recv name: (name) @prop) (class_constant_access_expression) @cc]`;
const Q_CONFIG_GET_DYN = `
  (function_call_expression function: (name) @fn arguments: (arguments
    . (argument ${DYN_ARG}) . (argument (string (string_content) @key))))`;
const Q_CONFIG_SET_DYN = `
  (function_call_expression function: (name) @fn arguments: (arguments
    . (argument (string (string_content) @key)) . (argument) . (argument ${DYN_ARG})))`;
```
`CompiledQueries`에 `configGet`·`configSet`·`configGetDyn`·`configSetDyn`. 추출(문자열 호출 추출 뒤):
```ts
    const configCalls: ConfigCall[] = [];
    const dynamicConfigCalls: DynamicConfigCall[] = [];
    const configLiteral = (q: Parser.Query, kind: 'get' | 'set') => {
      for (const { caps } of runMatches(q)) {
        const fn = caps.get('fn')!;
        if (configFunctionKind(fn.text) !== kind) continue;
        const key = caps.get('key')!;
        configCalls.push({
          plugin: caps.get('plugin')!.text, key: key.text, kind,
          keyLine: key.startPosition.row, keyColumn: key.startPosition.column, keyIndex: key.startIndex, index: fn.startIndex,
        });
      }
    };
    configLiteral(this.queries.configGet, 'get');
    configLiteral(this.queries.configSet, 'set');
    const configDynamic = (q: Parser.Query, kind: 'get' | 'set') => {
      for (const { caps } of runMatches(q)) {
        const fn = caps.get('fn')!;
        if (configFunctionKind(fn.text) !== kind) continue;
        const comp = componentRefOf(caps);
        if (!comp) continue;
        const key = caps.get('key')!;
        dynamicConfigCalls.push({
          key: key.text, comp, kind,
          keyLine: key.startPosition.row, keyColumn: key.startPosition.column, keyIndex: key.startIndex,
          index: fn.startIndex, scope: scopeOf(fn),
        });
      }
    };
    configDynamic(this.queries.configGetDyn, 'get');
    configDynamic(this.queries.configSetDyn, 'set');
```
파일 하단 헬퍼(`scopeOf` 근처):
```ts
/** 동적 인자 캡처를 컴포넌트 참조로. 다른 객체의 프로퍼티는 이 파일에서 정의를 알 수 없어 null. */
function componentRefOf(caps: Map<string, Parser.SyntaxNode>): ComponentRef | null {
  const v = caps.get('var');
  if (v) return { kind: 'var', name: v.text };
  const p = caps.get('prop');
  if (p) return caps.get('recv')!.text === '$this' ? { kind: 'prop', name: p.text } : null;
  const cc = caps.get('cc');
  if (cc) { const names = cc.descendantsOfType('name'); const last = names[names.length - 1]; return last ? { kind: 'const', name: last.text } : null; }
  return null;
}
```
`facts()`의 반환 객체에 `configCalls, dynamicConfigCalls` 추가. `runMatches`의 `caps`가 `Map<string, SyntaxNode>`가 아니면 그 타입에 맞춘다.

- [ ] **Step 4: GREEN.** 커밋 `feat(infra): get_config/set_config 팩트 — 리터럴·동적 플러그인`.

---

### Task 5: 사용처 색인 — 설정 참조

**Files:**
- Modify: `src/infrastructure/usage/php-usage-index.ts`
- Test: `test/unit/infra/php-usage-index.test.ts`

**Interfaces:**
- Produces: `PhpUsageIndex implements ConfigUsageRepository` — `configRefsOf(plugin, key): SourceLocation[]`

- [ ] **Step 1: 실패하는 테스트**

```ts
  it('설정 참조: get_config·set_config 키 위치, 값에 괄호가 든 set_config는 침묵, 증분 제거', () => {
    const idx2 = new PhpUsageIndex(() => false);
    const src = "<?php\n$a = get_config('local_ubattend', 'apikey');\nset_config('mode', 1, 'local_ubattend');\nset_config('nest', get_config('a', 'b'), 'local_ubattend');\nset_config('core_only', 1);\n";
    idx2.updateFileText('/c.php', src);
    const lines = src.split('\n');
    const get = idx2.configRefsOf('local_ubattend', 'apikey');
    assert.equal(get.length, 1); assert.equal(get[0].line, 1); assert.equal(get[0].column, lines[1].indexOf('apikey'));
    const set = idx2.configRefsOf('local_ubattend', 'mode');
    assert.equal(set.length, 1); assert.equal(set[0].column, lines[2].indexOf('mode'));
    assert.equal(idx2.configRefsOf('local_ubattend', 'nest').length, 0, '값에 괄호 → 정규식으로 안전하게 자를 수 없어 침묵');
    assert.equal(idx2.configRefsOf('a', 'b').length, 1, '안쪽 get_config는 그 자체로 사용처');
    assert.equal(idx2.configRefsOf('core', 'core_only').length, 0, '두 인자 set_config(core)는 범위 밖');
    idx2.updateFileText('/c.php', '<?php\n');
    assert.equal(idx2.configRefsOf('local_ubattend', 'apikey').length, 0);
  });
```

- [ ] **Step 2: RED 확인.**
- [ ] **Step 3: 구현**

```ts
import { ConfigUsageRepository } from '../../domain/moodle-model/ports/config-usage-repository';
import { configKeyId } from '../../domain/moodle-model/services/config-plugin';

// 설정 사용처 — get_config(plugin, key) / set_config(key, value, plugin). 값에 괄호가 있으면 어디서 끝나는지 정규식으로 알 수 없어 비매칭.
const CONFIG_GET_RE = /\bget_config\(\s*['"](\w+)['"]\s*,\s*['"](\w+)['"]\s*\)/g;
const CONFIG_SET_RE = /\bset_config\(\s*['"](\w+)['"]\s*,\s*[^;()]*?,\s*['"](\w+)['"]\s*\)/g;

interface ConfigEntry { id: string; loc: SourceLocation; }
// 클래스 필드
  private byConfigId = new Map<string, SourceLocation[]>();
  private configByFile = new Map<string, ConfigEntry[]>();
```
`updateFileText`: `prevC`를 제거하고 `extractPhp`가 돌려주는 `cEntries`를 추가(`js`·`mustache` 추출은 `cEntries: []`). `extractPhp` 안, 세 개의 반복되는 "증분 라인 계산" 루프를 헬퍼로 모은다:
```ts
/** 매치마다 (줄, 줄 시작 오프셋)을 누적해서 준다 — 매치마다 앞을 되짚으면 매치 수에 제곱이 된다. */
function forEachMatch(text: string, re: RegExp, fn: (m: RegExpExecArray, line: number, lineStart: number) => void): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  let lastIdx = 0, line = 0, lineStart = 0;
  while ((m = re.exec(text))) {
    for (let i = lastIdx; i < m.index; i++) if (text.charCodeAt(i) === 10) { line++; lineStart = i + 1; }
    lastIdx = m.index;
    fn(m, line, lineStart);
  }
}
```
기존 USAGE_RE·TEMPLATE_USAGE_RE·AMD_USAGE_RE 루프를 이 헬퍼로 바꾸고(동작 동일 — 기존 테스트가 핀), 설정 두 개를 추가:
```ts
    forEachMatch(text, CONFIG_GET_RE, (m, line, lineStart) => {
      const keyOffset = m[0].indexOf(m[2], m[0].indexOf(',')); // 둘째 리터럴의 내용 시작
      cEntries.push({ id: configKeyId(m[1], m[2]), loc: { uri, line, column: m.index - lineStart + keyOffset } });
    });
    forEachMatch(text, CONFIG_SET_RE, (m, line, lineStart) => {
      cEntries.push({ id: configKeyId(m[2], m[1]), loc: { uri, line, column: m.index - lineStart + m[0].search(/['"]/) + 1 } });
    });
```
`configRefsOf(plugin, key) { return this.byConfigId.get(configKeyId(plugin, key)) ?? []; }`, `addConfigEntry`/`removeConfigEntry`는 템플릿 항목과 같은 꼴.

- [ ] **Step 4: GREEN**(기존 usage 테스트 전부 포함). 커밋 `feat(infra): 사용처 색인에 설정 참조 추가 + 라인 계산 헬퍼`.

---

### Task 6: 애플리케이션 유스케이스

**Files:**
- Create: `src/application/config-call-lookup.ts`, `locate-config-target.ts`, `resolve-config-definition.ts`, `describe-config-key.ts`, `find-config-references.ts`, `list-resolved-config-refs.ts`, `complete-config-keys.ts`
- Modify: `src/application/dto.ts`(`ReferenceTarget`), `describe-string.ts`·`describe-js-symbol.ts`·`describe-mustache-symbol.ts`(target에 `kind: 'string'`)
- Modify(테스트): `test/unit/application/string-usecases.test.ts`·`js-usecases.test.ts`·`mustache-usecases.test.ts`의 `target` deepEqual에 `kind: 'string'` 추가
- Test: `test/unit/application/config-usecases.test.ts`

**Interfaces (Produces):**
```ts
// dto.ts
export interface ReferenceTarget { kind: 'string' | 'config'; component: string; key: string; }  // config는 component 자리에 plugin
export interface HoverResult { markdown: string; target?: ReferenceTarget; }
export interface ConfigKeyItem { key: string; settingClass: string; }
// config-call-lookup.ts
export function allConfigCalls(facts: DocumentFacts): ConfigCall[]
export function findConfigCallAt(facts: DocumentFacts, atIndex: number): ConfigCall | undefined
// locate-config-target.ts
export interface ConfigTarget { plugin: string; key: string; }
export class LocateConfigTarget { constructor(syntax: PhpSyntax, configs: ConfigKeyRepository); php(text, at): ConfigTarget | null; settings(file: string, line: number): ConfigTarget | null; }
export class ResolveConfigDefinition { constructor(syntax, configs); run(text, at): DefinitionResult[] }
export class DescribeConfigKey { constructor(syntax, configs, displayPath: (uri: string) => string); run(text, at): HoverResult | null }
export class FindConfigReferences { constructor(usages: ConfigUsageRepository, configs: ConfigKeyRepository); run(plugin, key, includeDeclaration = false): SourceLocation[] }
export class ListResolvedConfigRefs { constructor(syntax, configs); run(text): RangeItem[]; hasCalls(text): boolean }
export class CompleteConfigKeys { constructor(configs); run(plugin): ConfigKeyItem[] }
```

- [ ] **Step 1: 실패하는 테스트** — `config-usecases.test.ts`

```ts
import { strict as assert } from 'assert';
import { join } from 'path';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/tree-sitter/tree-sitter-php-syntax';
import { ConfigKeyIndex } from '../../../src/infrastructure/config/config-key-index';
import { PhpUsageIndex } from '../../../src/infrastructure/usage/php-usage-index';
import { clearPluginTypeCache } from '../../../src/infrastructure/workspace/plugin-type-map';
import { LocateConfigTarget } from '../../../src/application/locate-config-target';
import { ResolveConfigDefinition } from '../../../src/application/resolve-config-definition';
import { DescribeConfigKey } from '../../../src/application/describe-config-key';
import { FindConfigReferences } from '../../../src/application/find-config-references';
import { ListResolvedConfigRefs } from '../../../src/application/list-resolved-config-refs';
import { CompleteConfigKeys } from '../../../src/application/complete-config-keys';

const root = join(__dirname, '../../fixtures/mini-moodle');
const settingsFile = join(root, 'local/ubattend/settings.php');
const CODE = `<?php
class z {
  public $pluginname = 'local_ubattend';
  function f() {
    $a = get_config('local_ubattend', 'apikey');
    set_config('mode', 1, 'local_ubattend');
    $b = get_config($this->pluginname, 'attendlimit');
    $c = get_config('local_ubattend', 'nope');
    $d = get_config('mod_ubattend', 'apikey');
  }
}
`;

describe('설정 키 유스케이스 (E2E)', () => {
  let syn: TreeSitterPhpSyntax; const configs = new ConfigKeyIndex(); const usages = new PhpUsageIndex(() => false);
  before(async () => {
    clearPluginTypeCache();
    syn = await TreeSitterPhpSyntax.create();
    await configs.buildFromRootAsync(root);
    usages.updateFileText('/z.php', CODE);
  });
  const at = (needle: string) => CODE.indexOf(needle) + 1;

  it('위치→대상: 리터럴·전파, 키 밖·모르는 키도 대상은 준다(해석은 다음 단계)', () => {
    const locate = new LocateConfigTarget(syn, configs);
    assert.deepEqual(locate.php(CODE, at("'apikey'")), { plugin: 'local_ubattend', key: 'apikey' });
    assert.deepEqual(locate.php(CODE, at("'attendlimit'")), { plugin: 'local_ubattend', key: 'attendlimit' });
    assert.equal(locate.php(CODE, at("'local_ubattend', 'apikey'")), null, '플러그인 인자 위는 아님');
    assert.deepEqual(locate.settings(settingsFile, configs.declaration('local_ubattend', 'apikey')!.location.line),
      { plugin: 'local_ubattend', key: 'apikey' });
    assert.equal(locate.settings(settingsFile, 0), null);
  });
  it('정의 이동: settings.php 선언 줄, 모르는 키·다른 플러그인은 []', () => {
    const r = new ResolveConfigDefinition(syn, configs);
    const [d] = r.run(CODE, at("'apikey'"));
    assert.equal(d.location.uri, settingsFile);
    assert.deepEqual(r.run(CODE, at("'nope'")), []);
    assert.deepEqual(r.run(CODE, at("'mod_ubattend'") + 20), [], 'mod_ubattend/apikey는 선언이 없다');
  });
  it('hover: plugin/key·설정 클래스·상대 경로 + config 대상', () => {
    const h = new DescribeConfigKey(syn, configs, uri => uri.replace(root + '/', ''))!.run(CODE, at("'mode'"))!;
    assert.match(h.markdown, /\*\*local_ubattend \/ mode\*\*/);
    assert.match(h.markdown, /admin_setting_configselect/);
    assert.match(h.markdown, /local\/ubattend\/settings\.php/);
    assert.deepEqual(h.target, { kind: 'config', component: 'local_ubattend', key: 'mode' });
  });
  it('참조: 사용처(+선언)', () => {
    const f = new FindConfigReferences(usages, configs);
    assert.equal(f.run('local_ubattend', 'apikey').length, 1);
    const withDecl = f.run('local_ubattend', 'apikey', true);
    assert.equal(withDecl.length, 2);
    assert.equal(withDecl[0].uri, settingsFile);
    assert.deepEqual(f.run('local_ubattend', 'nope', true), [], '선언 없고 사용처 없음');
  });
  it('하이라이트: 선언이 있는 키만(전파 포함)', () => {
    const l = new ListResolvedConfigRefs(syn, configs);
    assert.deepEqual(l.run(CODE).map(r => r.length).sort(), ['apikey'.length, 'attendlimit'.length, 'mode'.length].sort());
    assert.equal(l.hasCalls(CODE), true);
    assert.equal(l.hasCalls('<?php echo 1;'), false);
  });
  it('완성: 플러그인의 선언된 키(heading 제외)와 설정 클래스', () => {
    const items = new CompleteConfigKeys(configs).run('local_ubattend');
    assert.deepEqual(items.map(i => i.key).sort(), ['apikey', 'attendlimit', 'mode']);
    assert.equal(items.find(i => i.key === 'mode')!.settingClass, 'admin_setting_configselect');
  });
});
```

- [ ] **Step 2: RED 확인.**
- [ ] **Step 3: 구현**

`config-call-lookup.ts`:
```ts
import { ConfigCall, DocumentFacts } from '../domain/code-analysis/facts';
import { resolveComponentRef } from '../domain/lang-model/services/component-propagation';
import { itemWithKeyAt } from '../domain/code-analysis/key-at';

/** 설정 호출 전부 — 리터럴 플러그인 호출과, 리터럴로 해석되는 동적 플러그인 호출. 해석되지 않는 동적 호출은 없다(침묵). */
export function allConfigCalls(facts: DocumentFacts): ConfigCall[] {
  const out: ConfigCall[] = [...facts.configCalls];
  for (const call of facts.dynamicConfigCalls) {
    const plugin = resolveComponentRef(facts, call);
    if (plugin === null) continue;
    out.push({ plugin, key: call.key, kind: call.kind, keyLine: call.keyLine, keyColumn: call.keyColumn, keyIndex: call.keyIndex, index: call.index });
  }
  return out;
}
export function findConfigCallAt(facts: DocumentFacts, atIndex: number): ConfigCall | undefined {
  return itemWithKeyAt(allConfigCalls(facts), atIndex);
}
```
`locate-config-target.ts`:
```ts
export interface ConfigTarget { plugin: string; key: string; }
export class LocateConfigTarget {
  constructor(private syntax: PhpSyntax, private configs: ConfigKeyRepository) {}
  php(text: string, atIndex: number): ConfigTarget | null {
    const c = findConfigCallAt(this.syntax.facts(text), atIndex);
    return c ? { plugin: configPlugin(c.plugin), key: c.key } : null;
  }
  /** settings.php의 선언 줄(`new admin_setting_*` 줄)에서 */
  settings(file: string, line: number): ConfigTarget | null {
    const d = this.configs.declarationsIn(file).find(x => x.location.line === line);
    return d ? { plugin: d.plugin, key: d.key } : null;
  }
}
```
`resolve-config-definition.ts`: `run(text, at)` → `findConfigCallAt` → `configs.declaration(plugin, key)` → `[{ location }]` 또는 `[]`.
`describe-config-key.ts`:
```ts
export class DescribeConfigKey {
  constructor(private syntax: PhpSyntax, private configs: ConfigKeyRepository, private displayPath: (uri: string) => string) {}
  run(text: string, atIndex: number): HoverResult | null {
    const c = findConfigCallAt(this.syntax.facts(text), atIndex);
    if (!c) return null;
    const plugin = configPlugin(c.plugin);
    const d = this.configs.declaration(plugin, c.key);
    if (!d) return null;
    const where = `${this.displayPath(d.location.uri)}:${d.location.line + 1}`;
    return { markdown: [`**${plugin} / ${c.key}**`, d.settingClass, where].join('\n\n'), target: { kind: 'config', component: plugin, key: c.key } };
  }
}
```
`find-config-references.ts`: 문자열의 `FindStringReferences`와 같은 꼴 — `includeDeclaration`이면 `configs.declaration(plugin, key)?.location`을 앞에, 이어서 `usages.configRefsOf(configPlugin(plugin), key)`.
`list-resolved-config-refs.ts`: `run(text)`: `allConfigCalls` 중 `configs.declaration(configPlugin(c.plugin), c.key)`가 있는 것의 `{ line: keyLine, column0: keyColumn, length: key.length }`. `hasCalls(text)`: `facts.configCalls.length + facts.dynamicConfigCalls.length > 0`.
`complete-config-keys.ts`: `run(plugin)`: `configs.keysOfPlugin(plugin).map(d => ({ key: d.key, settingClass: d.settingClass }))`.
`dto.ts`: `StringTarget` → `ReferenceTarget`(위). `LocateStringTarget`·`StringReferenceProvider`가 쓰는 `StringTarget`은 `{ component; key }`로 남겨 두고(`export interface StringTarget { component: string; key: string; }`), hover의 target만 `ReferenceTarget`. 세 describe에서 `target: { kind: 'string', component, key }`. 기존 테스트 3곳의 deepEqual에 `kind: 'string'` 추가.

- [ ] **Step 4: GREEN.** 커밋 `feat(app): 설정 키 유스케이스 — 위치·정의·hover·참조·하이라이트·완성`.

---

### Task 7: 프레젠테이션 일반화(문자열 전용 → 대상 타입)

**Files:**
- Rename/Modify: `src/presentation/string-references-link.ts` → `src/presentation/references-link.ts`
- Rename/Modify: `src/presentation/string-hover.ts` → `src/presentation/references-hover.ts`
- Rename/Modify: `src/presentation/show-string-references.ts` → `src/presentation/show-references.ts`
- Rename/Modify: `src/presentation/providers/string-reference-provider.ts` → `target-reference-provider.ts`
- Rename/Modify: `src/presentation/providers/lang-code-lens-provider.ts` → `usage-code-lens-provider.ts`
- Create: `src/presentation/lens-targets.ts`
- Modify: `src/presentation/source-label.ts`(두 명령 신뢰), 세 hover 프로바이더, `src/extension.ts`(문자열 결선을 새 이름으로 — 동작 동일)
- Test: `test/unit/presentation/string-references-link.test.ts` → `references-link.test.ts`(시그니처 갱신), 신규 `test/unit/presentation/lens-targets.test.ts`

**Interfaces (Produces):**
```ts
// references-link.ts
export const SHOW_STRING_REFERENCES_COMMAND = 'csmscode.showStringReferences';
export const SHOW_CONFIG_REFERENCES_COMMAND = 'csmscode.showConfigReferences';
export function commandForKind(kind: 'string' | 'config'): string
export interface ReferenceCounter { built(): boolean; count(component: string, key: string): number; }
export type ReferenceCounters = Record<'string' | 'config', ReferenceCounter>;
export interface ShowReferencesArgs { uri: string; line: number; character: number; component: string; key: string; }
export function lensTitle(count: number | null): string
export function referencesCommandUri(command: string, args: ShowReferencesArgs): string
export function referencesLinkMarkdown(command: string, args: ShowReferencesArgs, count: number | null): string
// references-hover.ts
export function hoverWithReferences(doc: vscode.TextDocument, pos: vscode.Position, r: HoverResult, counters: ReferenceCounters): vscode.Hover
// show-references.ts
export function registerShowReferences(ctx, command: string, find: (component: string, key: string) => SourceLocation[], usage: UsageIndexHandle): void
// target-reference-provider.ts
export class TargetReferenceProvider<T> implements vscode.ReferenceProvider {
  constructor(locate: (doc: vscode.TextDocument, pos: vscode.Position) => T | null,
              find: (target: T, includeDeclaration: boolean) => SourceLocation[],
              usage: UsageIndexHandle, prepare?: () => Promise<void>)
}
// usage-code-lens-provider.ts
export interface UsageLensTarget { line: number; command: string; args: ShowReferencesArgs; count(): number | null; }
export class UsageCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  constructor(targetsOf: (doc: vscode.TextDocument) => UsageLensTarget[], enabled: () => boolean); refresh(): void;
}
// lens-targets.ts (vscode 없음)
export function langLensTargets(uri: string, entries: { key: string; line: number }[], component: string, counter: ReferenceCounter): UsageLensTarget[]
export function settingsLensTargets(uri: string, decls: { plugin: string; key: string; location: { line: number; column: number } }[], counter: ReferenceCounter): UsageLensTarget[]
```

- [ ] **Step 1: 실패하는 테스트** — `references-link.test.ts`(기존 파일 이름 바꾸고 시그니처 갱신) + `lens-targets.test.ts`

```ts
// references-link.test.ts — 기존 케이스를 command 인자 추가로 갱신하고 하나 추가
import { SHOW_STRING_REFERENCES_COMMAND, SHOW_CONFIG_REFERENCES_COMMAND, commandForKind, lensTitle, referencesLinkMarkdown, ShowReferencesArgs } from '../../../src/presentation/references-link';
it('kind별 명령', () => {
  assert.equal(commandForKind('string'), SHOW_STRING_REFERENCES_COMMAND);
  assert.equal(commandForKind('config'), SHOW_CONFIG_REFERENCES_COMMAND);
});
// referencesLinkMarkdown(SHOW_STRING_REFERENCES_COMMAND, ARGS, 2) 형태로 기존 단언 유지

// lens-targets.test.ts
import { strict as assert } from 'assert';
import { langLensTargets, settingsLensTargets } from '../../../src/presentation/lens-targets';
import { SHOW_CONFIG_REFERENCES_COMMAND, SHOW_STRING_REFERENCES_COMMAND } from '../../../src/presentation/references-link';
const counter = { built: () => true, count: (c: string, k: string) => `${c}/${k}`.length };
describe('lens targets', () => {
  it('lang: 항목마다 문자열 명령·개수', () => {
    const [t] = langLensTargets('file:///l.php', [{ key: 'k', line: 3 }], 'local_x', counter);
    assert.equal(t.line, 3); assert.equal(t.command, SHOW_STRING_REFERENCES_COMMAND);
    assert.deepEqual(t.args, { uri: 'file:///l.php', line: 3, character: 0, component: 'local_x', key: 'k' });
    assert.equal(t.count(), 'local_x/k'.length);
  });
  it('settings: 선언마다 설정 명령, 컬럼은 첫 인자, 색인 전이면 count null', () => {
    const [t] = settingsLensTargets('file:///s.php', [{ plugin: 'local_x', key: 'k', location: { line: 5, column: 20 } }], { built: () => false, count: () => 0 });
    assert.equal(t.command, SHOW_CONFIG_REFERENCES_COMMAND);
    assert.deepEqual(t.args, { uri: 'file:///s.php', line: 5, character: 20, component: 'local_x', key: 'k' });
    assert.equal(t.count(), null);
  });
});
```

- [ ] **Step 2: RED 확인.**
- [ ] **Step 3: 구현** — `git mv`로 이름을 바꾸고 내용을 일반화한다.

`references-link.ts`: 상수 두 개, `commandForKind`, `ReferenceCounter`·`ReferenceCounters`, `ShowReferencesArgs`(기존 `ShowStringReferencesArgs`), `lensTitle` 그대로, `referencesCommandUri(command, args)`·`referencesLinkMarkdown(command, args, count)`.
`lens-targets.ts`:
```ts
import { ReferenceCounter, SHOW_CONFIG_REFERENCES_COMMAND, SHOW_STRING_REFERENCES_COMMAND } from './references-link';
import { UsageLensTarget } from './providers/usage-code-lens-provider';
const countOf = (counter: ReferenceCounter, component: string, key: string) => () => counter.built() ? counter.count(component, key) : null;
export function langLensTargets(uri, entries, component, counter): UsageLensTarget[] {
  return entries.map(e => ({ line: e.line, command: SHOW_STRING_REFERENCES_COMMAND,
    args: { uri, line: e.line, character: 0, component, key: e.key }, count: countOf(counter, component, e.key) }));
}
export function settingsLensTargets(uri, decls, counter): UsageLensTarget[] {
  return decls.map(d => ({ line: d.location.line, command: SHOW_CONFIG_REFERENCES_COMMAND,
    args: { uri, line: d.location.line, character: d.location.column, component: d.plugin, key: d.key }, count: countOf(counter, d.plugin, d.key) }));
}
```
`usage-code-lens-provider.ts`: `LangStringLens` → `UsageLens extends vscode.CodeLens { constructor(range, readonly target: UsageLensTarget) }`; `provideCodeLenses(doc)`: `if (!enabled()) return []; return targetsOf(doc).map(t => new UsageLens(new vscode.Range(t.line, 0, t.line, 0), t))`; `resolveCodeLens`: `lens.command = { title: lensTitle(t.count()), command: t.command, arguments: [t.args] }`. `UsageLensTarget` 인터페이스는 이 파일에서 export(vscode 타입을 쓰지 않으므로 `lens-targets.ts`가 import해도 vscode를 끌어오지 않는다 — 단, 이 파일은 `import * as vscode`를 하므로 인터페이스는 **`references-link.ts`로 옮겨** `lens-targets.ts`가 vscode 없는 모듈만 import하게 한다).
`references-hover.ts`: `hoverWithReferences(doc, pos, r, counters)`: `r.target` 없으면 `hoverWithSource(r.markdown)`; 있으면 `const command = commandForKind(r.target.kind); const counter = counters[r.target.kind]; const args = { uri, line, character, component: r.target.component, key: r.target.key }; hoverWithSource(r.markdown, referencesLinkMarkdown(command, args, counter.built() ? counter.count(...) : null))`.
`source-label.ts`: `enabledCommands: [SHOW_STRING_REFERENCES_COMMAND, SHOW_CONFIG_REFERENCES_COMMAND]`.
`show-references.ts`: `registerShowReferences(ctx, command, find, usage)` — 핸들러는 `await ensureUsageIndex(usage); executeCommand('editor.action.showReferences', Uri.parse(args.uri), new Position(args.line, args.character), find(args.component, args.key).map(toVscodeLocation))`.
`target-reference-provider.ts`: `provideReferences`: `await this.prepare?.(); const t = this.locate(doc, pos); if (!t) return []; await ensureUsageIndex(this.usage); return this.find(t, ctx.includeDeclaration).map(toVscodeLocation);`.
세 hover 프로바이더: 생성자 `(uc, counters: ReferenceCounters)`, `hoverWithReferences(doc, pos, r, this.counters)`.
`extension.ts` 문자열 결선: `counters = { string: refCounter, config: { built: () => false, count: () => 0 } }`(config는 Task 8에서 채움), `registerShowReferences(ctx, SHOW_STRING_REFERENCES_COMMAND, (c, k) => findRefs.run(c, k), usageHandle)`, 참조 프로바이더 세 개는 `new TargetReferenceProvider((doc, pos) => locate.php(doc.getText(), doc.offsetAt(pos)), (t, incl) => findRefs.run(t.component, t.key, incl), usageHandle)` 꼴, lang 렌즈는 `new UsageCodeLensProvider(doc => { const component = componentOfLangFile(root, doc.uri.fsPath); return component ? langLensTargets(doc.uri.toString(), parseLangSafe(doc.getText()), component, refCounter) : []; }, () => cfg('strings.codeLens'))`.

- [ ] **Step 4: GREEN + compile + lint.** 동작은 0.15.0과 같아야 한다(라벨·명령 이름 불변). 커밋 `refactor(presentation): 참조 프로바이더·CodeLens·hover 링크·명령을 대상 종류에 일반화`.

---

### Task 8: 설정 표면 결선

**Files:**
- Create: `src/presentation/providers/config-definition-provider.ts`, `config-hover-provider.ts`, `config-key-completion-provider.ts`
- Create: `src/presentation/config-call-prefix.ts`
- Modify: `src/extension.ts`, `package.json`(설정 두 개)
- Test: `test/unit/presentation/config-call-prefix.test.ts`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { strict as assert } from 'assert';
import { configKeyCompletionPlugin } from '../../../src/presentation/config-call-prefix';
describe('configKeyCompletionPlugin — get_config 키 완성 문맥', () => {
  it("get_config('p', ' 뒤에서 입력 중 → p", () => assert.equal(configKeyCompletionPlugin("$a = get_config('local_ubattend', 'api"), 'local_ubattend'));
  it('플러그인 인자 위치 → null', () => assert.equal(configKeyCompletionPlugin("get_config('local_"), null));
  it("''·moodle은 core", () => assert.equal(configKeyCompletionPlugin("get_config('moodle', '"), 'core'));
  it('다른 함수 → null', () => assert.equal(configKeyCompletionPlugin("get_string('k', '"), null));
});
```

- [ ] **Step 2: RED 확인.**
- [ ] **Step 3: 구현**

`config-call-prefix.ts`:
```ts
import { configPlugin } from '../domain/moodle-model/services/config-plugin';
const KEY_PREFIX_RE = /\bget_config\(\s*['"](\w*)['"]\s*,\s*['"][\w]*$/;
/** 커서가 get_config의 키 리터럴을 입력 중이면 그 플러그인. set_config는 키가 먼저 와서 플러그인을 아직 모른다. */
export function configKeyCompletionPlugin(before: string): string | null {
  const m = before.match(KEY_PREFIX_RE);
  return m ? configPlugin(m[1]) : null;
}
```
`ConfigKeyCompletionProvider(uc: CompleteConfigKeys, ready: () => Promise<void>)`: `provideCompletionItems` async — `const plugin = configKeyCompletionPlugin(before); if (!plugin) return []; await ready(); return uc.run(plugin).map(i => { const it = new CompletionItem(i.key, CompletionItemKind.Property); it.detail = i.settingClass; return withSource(it, labelled); })`. 트리거 문자 `'`·`"`.
`ConfigDefinitionProvider(locate: LocateConfigTarget, uc: ResolveConfigDefinition, ready)`: `provideDefinition` async — `if (!locate.php(text, at)) return []; await ready(); return uc.run(text, at).map(toVscodeLocation(r.location))`. 대상 확인을 먼저 해서 무관한 F12가 색인을 깨우지 않게 한다.
`ConfigHoverProvider(locate, uc: DescribeConfigKey, counters, ready)`: 같은 순서로, `hoverWithReferences`.

`extension.ts`:
```ts
  // 선언 색인은 첫 요청에서 만든다(활성화 비용 0). 전역 핸들과 같은 Promise를 공유해 두 번 만들지 않는다.
  let configBuild: Promise<void> | undefined;
  let configReady = false;
  const configReadyListeners: Array<() => void> = [];
  const ensureConfig = () => configBuild ??= configKeys.buildFromRootAsync(root).then(() => { configReady = true; for (const l of configReadyListeners) l(); });
  // globalsHandle.build 안의 `await configKeys.buildFromRootAsync(root)` → `await ensureConfig()`

  const locateCfg = new LocateConfigTarget(syntax, configKeys);
  const resolveCfg = new ResolveConfigDefinition(syntax, configKeys);
  const describeCfg = new DescribeConfigKey(syntax, configKeys, uri => path.relative(root, uri));
  const findCfgRefs = new FindConfigReferences(usageIndex, configKeys);
  const listResolvedCfg = new ListResolvedConfigRefs(syntax, configKeys);
  const completeCfg = new CompleteConfigKeys(configKeys);
  const cfgCounter = { built: () => usageIndex.isBuilt, count: (p: string, k: string) => findCfgRefs.run(p, k).length };
  const counters = { string: refCounter, config: cfgCounter };
  registerShowReferences(ctx, SHOW_CONFIG_REFERENCES_COMMAND, (p, k) => findCfgRefs.run(p, k), usageHandle);
  const settingsSelector: vscode.DocumentSelector = [
    { language: 'php', scheme: 'file', pattern: '**/settings.php' },
    { language: 'php', scheme: 'file', pattern: '**/admin/settings/*.php' },
  ];
  const settingsLens = new UsageCodeLensProvider(doc => {
    if (!configReady) { void ensureConfig(); return []; } // settings.php를 열었다는 것 자체가 요청이다
    return settingsLensTargets(doc.uri.toString(), configKeys.declarationsIn(doc.uri.fsPath), cfgCounter);
  }, () => vscode.workspace.getConfiguration('csmscode').get<boolean>('config.codeLens', true));
  ctx.subscriptions.push(settingsLens);
  configReadyListeners.push(() => settingsLens.refresh());
```
등록:
```ts
    vscode.languages.registerDefinitionProvider(php, new ConfigDefinitionProvider(locateCfg, resolveCfg, ensureConfig)),
    vscode.languages.registerHoverProvider(php, new ConfigHoverProvider(locateCfg, describeCfg, counters, ensureConfig)),
    vscode.languages.registerCompletionItemProvider(php, new ConfigKeyCompletionProvider(completeCfg, ensureConfig), "'", '"'),
    vscode.languages.registerReferenceProvider(php, new TargetReferenceProvider(
      (doc, pos) => locateCfg.php(doc.getText(), doc.offsetAt(pos)), (t, incl) => findCfgRefs.run(t.plugin, t.key, incl), usageHandle, ensureConfig)),
    vscode.languages.registerReferenceProvider(settingsSelector, new TargetReferenceProvider(
      (doc, pos) => locateCfg.settings(doc.uri.fsPath, pos.line), (t, incl) => findCfgRefs.run(t.plugin, t.key, incl), usageHandle, ensureConfig)),
    vscode.languages.registerCodeLensProvider(settingsSelector, settingsLens),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('csmscode.config.codeLens')) settingsLens.refresh(); }),
```
하이라이트 소스 추가: `{ setting: 'config.highlightResolved', languages: ['php'], run: t => { if (configReady) return listResolvedCfg.run(t); if (listResolvedCfg.hasCalls(t)) void ensureConfig(); return []; } }` 그리고 `registerResolvedHighlight` 뒤에 `configReadyListeners.push(() => highlight.refreshAll())`.
워처:
```ts
  // settings.php 변경 → 선언 색인 그 파일만 갱신(색인이 아직 없으면 다음 빌드가 담는다)
  const settingsWatcher = vscode.workspace.createFileSystemWatcher('**/settings.php');
  const adminSettingsWatcher = vscode.workspace.createFileSystemWatcher('**/admin/settings/*.php');
  const onSettings = (uri: vscode.Uri, removed: boolean) => {
    if (!configReady) return;
    const done = removed ? Promise.resolve(configKeys.removeFile(uri.fsPath)) : configKeys.updateFile(uri.fsPath);
    void done.then(() => { settingsLens.refresh(); highlight.refreshAll(); });
  };
  for (const w of [settingsWatcher, adminSettingsWatcher]) ctx.subscriptions.push(w,
    w.onDidChange(u => onSettings(u, false)), w.onDidCreate(u => onSettings(u, false)), w.onDidDelete(u => onSettings(u, true)));
```
`package.json`:
```json
"csmscode.config.highlightResolved": { "type": "boolean", "default": true, "description": "settings.php 선언으로 해석되는 get_config·set_config 키를 링크 색상(textLink.foreground)으로 하이라이팅합니다." },
"csmscode.config.codeLens": { "type": "boolean", "default": true, "description": "settings.php의 admin_setting 선언 줄 위에 \"사용 N건\" 버튼(CodeLens)을 표시합니다. 클릭하면 그 자리에서 get_config·set_config 사용처 목록이 열립니다." }
```

- [ ] **Step 4: compile + lint + 전체 테스트 GREEN.** 커밋 `feat: get_config/set_config 정의 이동·hover·참조·CodeLens·완성 결선`.

---

### Task 9: 문서·버전 0.17.0·패키지·설치

**Files:** `package.json`(version), `CHANGELOG.md`, `README.md`, `docs/PHASE2-BACKLOG.md`, `docs/manual-verification.md`

- [ ] **Step 1: 문서**
  - README 기능 항목 "**설정 키 인텔리전스**: `get_config('local_x', 'key')`·`set_config('key', v, 'local_x')`의 키에서 F12로 `settings.php`의 `admin_setting_*` 선언으로 이동(`$name = $pluginname . '/key'` 관용구 추적), hover(설정 클래스·위치), 해석 키 하이라이팅, 코드↔선언 양방향 Shift+F12, settings.php 선언 줄 '사용 N건' 버튼, 키 완성. 플러그인 이름은 저장 키 그대로 비교(`ubboard`≠`mod_ubboard`)". 설정 표에 두 항목. 알려진 제한에 "동적 플러그인 호출은 사용처 목록·개수에 없음, 코어 키(`$CFG->x`)·통째 접근(`get_config('p')->key`)은 범위 밖".
  - CHANGELOG `## [0.17.0] — 2026-08-26`: 추가(위 항목 + 실측 89.7%/`$name` 관용구/`error` 아님 주의 없음), 수정(설정 선언 색인이 settings.php 저장 시 증분 갱신 — 전역 색인 중 처음), 비고(비목표 B·C·진단·제목 hover; 동적 플러그인 사용처).
  - 백로그: "전역 색인은 세션 중 갱신되지 않는다" 항목에 "설정 키는 0.17.0에서 settings.php 증분으로 해소, 클래스 멤버는 여전히" 갱신. 완료 목록에 항목 추가(스펙 경로). 후속: B·C·진단·hover 제목·`admin/settings.php` 등.
  - 수동 검증 62~66: get_config 키 F12 → settings.php 줄(`$name` 관용구 파일 `local/csmsmedia/settings.php`에서 확인), hover, Shift+F12 양방향, settings.php를 열면 잠시 후 "사용 N건" 버튼(첫 열기에 색인), settings.php 저장 후 새 키가 바로 해석, `get_config('local_x', '` 완성.
- [ ] **Step 2: 버전** `0.17.0`, `npm run compile && npm run lint && npm run test:unit && npx tsc -p tsconfig.test.json`.
- [ ] **Step 3: 패키지·설치** `npm run package` → `~/.vscode-server/bin/<commit>/bin/code-server --install-extension csms-code-0.17.0.vsix --force`.
- [ ] **Step 4: 커밋** `feat: 플러그인 설정 키 탐색 문서화 + 0.17.0`.

---

## Self-Review

- **스펙 커버리지**: §2 목표 1(정의·hover·전파) → Task 4·6·8, 2(하이라이트) → Task 6·8, 3(양방향 Shift+F12) → Task 5·6·7·8, 4(CodeLens·hover 링크) → Task 7·8, 5(완성) → Task 6·8, 6(settings.php 증분) → Task 3·8. §3.2 파서 관용구 전부 Task 2 테스트에 있음. §3.3 lazy·전역 핸들 공유 → Task 8. §3.5 `set_config` 괄호 침묵 → Task 5. §7 문서 → Task 9.
- **플레이스홀더**: 없음. "같은 꼴"로 지시한 곳(Task 6의 `FindConfigReferences`, Task 5의 add/remove)은 참조 코드가 같은 저장소에 있고 형태를 명시했다.
- **타입 일관성**: `ConfigTarget { plugin, key }`(Task 6)와 `TargetReferenceProvider`의 `find(t, incl)` 호출 `findCfgRefs.run(t.plugin, t.key, incl)`(Task 8) 일치. `ReferenceTarget.kind`(Task 6) ↔ `commandForKind`·`ReferenceCounters`(Task 7) 일치. `UsageLensTarget`은 `references-link.ts`에 두기로 Task 7 Step 3에서 확정 — `lens-targets.ts`·`usage-code-lens-provider.ts` 모두 거기서 import.
