# AMD 모듈 참조 이동 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `js_call_amd('local_ubion/user', 'index')`의 첫 인자에서 `amd/src/user.js`로 F12 이동, 해석 참조 하이라이팅, 모듈 파일에서 호출처 참조(Shift+F12).

**Architecture:** 템플릿 표면의 구조를 그대로 복제한다 — 열거·역산은 `moodle-root-resolver`, 색인은 `AmdIndex`(조립 함수 하나로 동기·비동기·증분 통과), 팩트는 기존 템플릿 쿼리 매치를 메서드명으로 갈라 담고, 사용처는 `PhpUsageIndex`에 종류를 하나 더 추가한다.

**Tech Stack:** TypeScript, web-tree-sitter(PHP WASM), mocha + ts-node, VS Code API.

## Global Constraints

- 설계 문서: `docs/superpowers/specs/2026-08-06-amd-module-navigation-design.md`. 충돌 시 설계 문서가 우선.
- 계층 규칙(eslint 강제): `domain/`은 fs·vscode·infrastructure 금지, `application/`은 infrastructure 금지.
- 해석되지 않는 참조에는 아무 반응도 하지 않는다(진단 없음).
- **주석은 객관적으로만**: 날짜·리뷰·계획 번호·변경 이력 서술 금지. 불변 조건과 이유만.
- 픽스처는 `test/fixtures/mini-moodle`에 추가한다(런타임 tmp는 symlink 테스트에만).
- 기존 232건 무회귀.

---

### Task 1: 열거·경로 역산 + 코어 서브시스템 매핑

**Files:**
- Modify: `src/infrastructure/workspace/moodle-root-resolver.ts`
- Create(픽스처): `test/fixtures/mini-moodle/local/ubattend/amd/src/setting.js`, `.../amd/src/sub/nested.js`, `.../local/ubattend/amd/build/setting.min.js`, `test/fixtures/mini-moodle/lib/amd/src/notification.js`, `test/fixtures/mini-moodle/lib/form/amd/src/submit.js`, `test/fixtures/mini-moodle/lib/components.json`
- Test: `test/unit/infra/resolver.test.ts`

**Interfaces:**
- Produces: `AmdFileRef { file, component, name }`, `listAmdFiles(root)`, `listAmdFilesAsync(root)`, `componentOfAmdFile(root, file)`, `coreSubsystemDirs(root)`

- [ ] **Step 1: 픽스처 추가**

`lib/components.json`은 실제 구조를 최소로 흉내낸다.
```json
{ "plugintypes": { "local": "local" }, "subsystems": { "form": "lib/form", "access": null } }
```
JS 파일 내용은 아무거나(`define(function () { return {}; });` 한 줄)면 된다 — 열거는 내용을 읽지 않는다.

- [ ] **Step 2: 실패하는 테스트 작성** — `resolver.test.ts` 맨 아래

```ts
describe('MoodleRootResolver — AMD 모듈 열거', () => {
  it('플러그인·코어·코어 서브시스템을 component/name으로 열거하고 amd/build는 제외', () => {
    const list = listAmdFiles(root).map(x => `${x.component}/${x.name}`).sort();
    assert.deepEqual(list, [
      'core/notification', 'core_form/submit',
      'local_ubattend/setting', 'local_ubattend/sub/nested',
    ]);
  });

  it('비동기 열거는 동기와 동일', async () => {
    const key = (xs: AmdFileRef[]) => xs.map(x => `${x.component}/${x.name}:${x.file}`).sort();
    assert.deepEqual(key(await listAmdFilesAsync(root)), key(listAmdFiles(root)));
  });

  it('componentOfAmdFile: 열거 결과를 되돌린다', () => {
    for (const ref of listAmdFiles(root)) {
      assert.deepEqual(componentOfAmdFile(root, ref.file), { component: ref.component, name: ref.name });
    }
  });

  it('componentOfAmdFile: amd/build·규칙 밖·루트 밖은 null', () => {
    assert.equal(componentOfAmdFile(root, join(root, 'local/ubattend/amd/build/setting.min.js')), null);
    assert.equal(componentOfAmdFile(root, join(root, 'local/ubattend/classes/thing.php')), null);
    assert.equal(componentOfAmdFile(root, '/etc/passwd'), null);
  });

  it('coreSubsystemDirs: null 값은 제외', () => {
    const m = coreSubsystemDirs(root);
    assert.equal(m.get('form'), 'lib/form');
    assert.ok(!m.has('access'));
  });

  it('coreSubsystemDirs: components.json이 없으면 빈 Map', () => {
    const tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-nocomp-'));
    assert.equal(coreSubsystemDirs(tmp).size, 0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
```
import 줄에 `listAmdFiles, listAmdFilesAsync, componentOfAmdFile, coreSubsystemDirs`와 타입 `AmdFileRef`를 추가한다.

- [ ] **Step 3: 실패 확인** — Run: `npm run test:unit -- --grep AMD` / Expected: 모듈에 해당 export 없음(컴파일 실패)

- [ ] **Step 4: 구현**

```ts
export interface AmdFileRef { file: string; component: string; name: string; }

/** lib/components.json의 서브시스템 → 루트 기준 디렉터리. 값이 null인 항목(디렉터리 없는 서브시스템)은 제외한다.
 *  이 파일은 구버전 Moodle에 없다 — 없으면 빈 Map이고 코어 서브시스템 모듈만 해석되지 않는다. */
export function coreSubsystemDirs(root: string): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'lib', 'components.json'), 'utf8'));
    for (const [name, dir] of Object.entries(raw?.subsystems ?? {})) {
      if (typeof dir === 'string' && dir) out.set(name, dir);
    }
  } catch { /* 파일 없음·JSON 파손 → 빈 Map */ }
  return out;
}
```

열거는 `listTemplateFiles`와 같은 realpath 순환 가드 walk를 쓴다. 대상 디렉터리 목록을 만들고(각 항목은 `{ dir, component }`), 그 아래 `**/*.js`를 모아 name을 계산한다.
```ts
function amdRoots(root: string): { dir: string; component: string }[] {
  const out = [{ dir: path.join(root, 'lib', 'amd', 'src'), component: 'core' }];
  for (const [sub, rel] of coreSubsystemDirs(root)) {
    out.push({ dir: path.join(root, rel, 'amd', 'src'), component: `core_${sub}` });
  }
  for (const [type, relDir] of Object.entries(PLUGIN_DIRS)) {
    const typeDir = path.join(root, relDir);
    if (!fs.existsSync(typeDir)) continue;
    for (const name of safeReaddir(typeDir)) {
      out.push({ dir: path.join(typeDir, name, 'amd', 'src'), component: `${type}_${name}` });
    }
  }
  return out;
}

/** amd/src 이하 경로에서 확장자를 뗀 모듈 이름. 구분자는 항상 `/`(참조 문자열과 같은 형태). */
function amdNameOf(srcDir: string, file: string): string {
  return path.relative(srcDir, file).split(path.sep).join('/').replace(/\.js$/, '');
}

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
      if (f.endsWith('.js')) out.push({ file: path.join(dir, f), component, name: amdNameOf(srcDir, path.join(dir, f)) });
    }
    for (const d of safeReaddir(dir)) walk(path.join(dir, d), srcDir, component, seen);
  };
  for (const { dir, component } of amdRoots(root)) walk(dir, dir, component, new Set());
  return out;
}
```
비동기 판은 `listTemplateFilesAsync`와 같은 방식(`fs.promises` + `INDEX_YIELD_EVERY`마다 `yieldNow()`)으로 쓴다.

역산은 경로 규칙을 그대로 되돌린다. `amd/src`가 경로에 있어야 하고, `amd/build`는 배제된다.
```ts
/** amd/src 파일 → { component, name }. 규칙 밖은 null. */
export function componentOfAmdFile(root: string, file: string): { component: string; name: string } | null {
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !file.endsWith('.js')) return null;
  const parts = rel.split(path.sep);
  const i = parts.findIndex((seg, k) => seg === 'src' && parts[k - 1] === 'amd');
  if (i < 1) return null;
  const name = parts.slice(i + 1).join('/').replace(/\.js$/, '');
  if (!name) return null;
  const beforeAmd = parts.slice(0, i - 1);
  const prefix = beforeAmd.join('/');
  if (prefix === 'lib') return { component: 'core', name };
  for (const [sub, relDir] of coreSubsystemDirs(root)) {
    if (prefix === relDir.split('/').join('/')) return { component: `core_${sub}`, name };
  }
  const hit = pluginTypeOfRel(beforeAmd.join(path.sep) + path.sep + 'x');   // pluginTypeOfRel은 type/name 뒤에 한 세그먼트를 더 요구한다
  if (!hit) return null;
  return { component: `${hit.type}_${hit.name}`, name };
}
```
`pluginTypeOfRel`은 `parts.length >= dirParts.length + 2`를 요구하므로, 플러그인 디렉터리까지만 남은 경로에는 더미 세그먼트를 붙여 호출한다. 이 사정을 주석으로 남긴다.

- [ ] **Step 5: 통과 확인** — Run: `npm run test:unit`

- [ ] **Step 6: 커밋**
```bash
git add src/infrastructure/workspace/moodle-root-resolver.ts test/fixtures/mini-moodle test/unit/infra/resolver.test.ts
git commit -m "feat(infra): AMD 모듈 파일 열거·경로 역산 + 코어 서브시스템 매핑"
```

---

### Task 2: `AmdIndex` + 포트 + 공유 참조 파서

**Files:**
- Create: `src/domain/shared/module-ref.ts`, `src/domain/amd-model/ports/amd-repository.ts`, `src/infrastructure/amd/amd-index.ts`
- Modify: `src/domain/template-model/template-ref.ts` (공유 파서 위임)
- Test: `test/unit/infra/amd-index.test.ts`

**Interfaces:**
- Consumes: Task 1의 `listAmdFiles`/`listAmdFilesAsync`
- Produces: `parseModuleRef(raw): { component, name } | null`, `AmdRepository`, `AmdIndex`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
const root = join(__dirname, '../../fixtures/mini-moodle');

describe('AmdIndex', () => {
  it('component/name으로 모듈 위치를 준다(중첩 경로 포함)', () => {
    const idx = new AmdIndex(); idx.buildFromRoot(root);
    assert.ok(idx.has('local_ubattend', 'setting'));
    assert.ok(idx.has('local_ubattend', 'sub/nested'));
    assert.ok(idx.locationsOf('local_ubattend', 'setting')[0].uri.endsWith(join('amd', 'src', 'setting.js')));
    assert.equal(idx.has('local_ubattend', 'nope'), false);
  });

  it('동기 ≡ 비동기', async () => {
    const s = new AmdIndex(); s.buildFromRoot(root);
    const a = new AmdIndex(); await a.buildFromRootAsync(root);
    const dump = (i: AmdIndex) => listAmdFiles(root)
      .map(r => `${r.component}/${r.name}:${i.locationsOf(r.component, r.name).map(l => l.uri).join(',')}`).sort();
    assert.deepEqual(dump(a), dump(s));
  });

  it('증분이 전체 재빌드와 수렴한다', () => {
    const inc = new AmdIndex(); inc.buildFromRoot(root);
    const ref = listAmdFiles(root)[0];
    inc.removeFile(ref.file);
    assert.equal(inc.locationsOf(ref.component, ref.name).length, 0);
    inc.updateFile(ref.file, ref.component, ref.name);
    const full = new AmdIndex(); full.buildFromRoot(root);
    const dump = (i: AmdIndex) => listAmdFiles(root)
      .map(r => `${r.component}/${r.name}:${i.locationsOf(r.component, r.name).map(l => l.uri).join(',')}`).sort();
    assert.deepEqual(dump(inc), dump(full));
  });

  // 위 dump는 파일시스템을 열거하므로 색인에만 남은 잔여 키를 볼 수 없다 —
  // 옛 키 정리는 직접 확인해야 한다(updateFile의 removeFile 선행 경로).
  it('다른 키에 등록됐던 파일은 재등록 시 옛 키에서 사라진다', () => {
    const idx = new AmdIndex(); idx.buildFromRoot(root);
    const ref = listAmdFiles(root)[0];
    idx.updateFile(ref.file, 'wrong_comp', ref.name);
    assert.equal(idx.locationsOf('wrong_comp', ref.name).length, 1);
    idx.updateFile(ref.file, ref.component, ref.name);
    assert.equal(idx.locationsOf('wrong_comp', ref.name).length, 0, '옛 키에 잔여');
    assert.equal(idx.locationsOf(ref.component, ref.name).length, 1);
  });

  it('이미 등록된 파일의 updateFile은 아무것도 바꾸지 않는다', () => {
    const idx = new AmdIndex(); idx.buildFromRoot(root);
    const ref = listAmdFiles(root)[0];
    const before = idx.locationsOf(ref.component, ref.name).map(l => l.uri);
    idx.updateFile(ref.file, ref.component, ref.name);
    assert.deepEqual(idx.locationsOf(ref.component, ref.name).map(l => l.uri), before);
  });
});

describe('parseModuleRef', () => {
  it('component/name 분해, name은 하위 경로 허용', () => {
    assert.deepEqual(parseModuleRef('local_x/a/b'), { component: 'local_x', name: 'a/b' });
  });
  it('슬래시 없음·앞뒤 슬래시는 null', () => {
    assert.equal(parseModuleRef('bare'), null);
    assert.equal(parseModuleRef('/x'), null);
    assert.equal(parseModuleRef('x/'), null);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run test:unit -- --grep AmdIndex`

- [ ] **Step 3: 공유 파서 추출**

`src/domain/shared/module-ref.ts`
```ts
export interface ModuleRef { component: string; name: string; }

/** `component/name` 분해 — 템플릿 참조와 AMD 모듈 참조가 같은 규칙을 쓴다.
 *  `/`가 없거나 양 끝에 있으면 참조가 아니다(침묵). name은 하위 경로를 포함할 수 있다. */
export function parseModuleRef(raw: string): ModuleRef | null {
  const i = raw.indexOf('/');
  if (i <= 0 || i === raw.length - 1) return null;
  return { component: raw.slice(0, i), name: raw.slice(i + 1) };
}
```
`template-ref.ts`는 이 함수에 위임하고 기존 이름·타입을 유지한다(호출부 무변경).
```ts
import { parseModuleRef, ModuleRef } from '../shared/module-ref';
export type TemplateRef = ModuleRef;
export const parseTemplateRef = parseModuleRef;
```

- [ ] **Step 4: 포트와 색인 구현**

`amd-repository.ts`는 `TemplateRepository`와 같은 모양(`locationsOf`, `has`).
`amd-index.ts`는 `template-index.ts`를 그대로 따르되 `listAmdFiles`/`listAmdFilesAsync`를 쓴다. `updateFile`의 순서 보존 조건(이미 같은 uri가 있으면 즉시 반환)을 반드시 포함한다.

- [ ] **Step 5: 통과 확인** — Run: `npm run test:unit`

- [ ] **Step 6: 커밋**
```bash
git commit -m "feat(infra): AmdIndex — 모듈 색인·증분 + component/name 파서 공유"
```

---

### Task 3: 팩트 `amdCalls`

**Files:**
- Modify: `src/domain/code-analysis/facts.ts`, `src/infrastructure/tree-sitter/tree-sitter-php-syntax.ts`
- Test: `test/unit/infra/tree-sitter.test.ts`

**Interfaces:**
- Produces: `AmdCall { ref, refLine, refColumn, refIndex, index }`, `DocumentFacts.amdCalls`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
const CODE8 = `<?php
function page() {
  $PAGE->requires->js_call_amd('local_ubattend/setting', 'init');
  $PAGE->requires->js_call_amd('local_ubattend/sub/nested', 'init', [1]);
  $this->page->requires->js_call_amd('block_testblock/main', 'init');
  $PAGE->requires->js_call_amd($dynamic, 'init');
  $OUTPUT->render_from_template('local_ubattend/setting', []);
}
`;

describe('TreeSitterPhpSyntax — amdCalls (js_call_amd)', () => {
  let syn: TreeSitterPhpSyntax; let f: any;
  before(async () => { syn = await TreeSitterPhpSyntax.create(); f = syn.facts(CODE8); });

  it('수신자 무관 추출·중첩 경로 포함, 동적 인자는 비추출', () => {
    assert.deepEqual(f.amdCalls.map((x: any) => x.ref),
      ['local_ubattend/setting', 'local_ubattend/sub/nested', 'block_testblock/main']);
  });
  it('ref 위치 정확성', () => {
    const c = f.amdCalls[0];
    assert.equal(CODE8.slice(c.refIndex, c.refIndex + c.ref.length), 'local_ubattend/setting');
    assert.equal(c.refLine, 2);
  });
  it('render_from_template과 섞이지 않는다', () => {
    assert.deepEqual(f.templateCalls.map((x: any) => x.ref), ['local_ubattend/setting']);
    assert.ok(!f.amdCalls.some((x: any) => x.ref === 'local_ubattend/setting' && x.refLine === 6));
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run test:unit -- --grep amdCalls`

- [ ] **Step 3: 구현** — `facts.ts`에 `AmdCall`과 `amdCalls` 추가(`emptyFacts()`에도), tree-sitter에서 기존 templateCall 매치 루프를 메서드명으로 분기한다.

팩트 종류가 늘면 손으로 쓴 `DocumentFacts` 리터럴이 컴파일 오류(TS2741)를 낸다. 두 곳을 `emptyFacts()`로 바꿔 다시 겪지 않게 한다.
- `test/unit/infra/cached-php-syntax.test.ts:11` → `return emptyFacts();`
- `test/unit/domain/inference.test.ts:6` → `const base: DocumentFacts = emptyFacts();`

```ts
    const templateCalls: TemplateCall[] = [];
    const amdCalls: AmdCall[] = [];
    for (const { caps } of runMatches(this.queries.templateCall)) {
      const method = caps.get('method')!;
      // 이 쿼리는 첫 인자가 문자열인 모든 메서드 호출($DB->get_record 포함)에 매칭된다 —
      // 관심 있는 메서드가 아니면 객체를 만들기 전에 빠진다.
      if (method.text !== 'render_from_template' && method.text !== 'js_call_amd') continue;
      const ref = caps.get('ref')!;
      const call = {
        ref: ref.text,
        refLine: ref.startPosition.row, refColumn: ref.startPosition.column, refIndex: ref.startIndex,
        index: method.startIndex,
      };
      if (method.text === 'render_from_template') templateCalls.push(call);
      else amdCalls.push(call);
    }
```
쿼리 상수 주석을 "첫 문자열 인자를 받는 메서드 호출 — 메서드명으로 종류를 가른다"로 갱신한다.

- [ ] **Step 4: 통과 확인** — Run: `npm run test:unit`

- [ ] **Step 5: 커밋**
```bash
git commit -m "feat(infra): js_call_amd 모듈 참조 팩트 추출"
```

---

### Task 4: 사용처 색인 + 유즈케이스 3개

**Files:**
- Modify: `src/infrastructure/usage/php-usage-index.ts`
- Create: `src/domain/amd-model/ports/amd-usage-repository.ts`, `src/application/resolve-amd-definition.ts`, `src/application/list-resolved-amd-calls.ts`, `src/application/find-amd-references.ts`
- Test: `test/unit/infra/php-usage-index.test.ts`, `test/unit/application/amd-usecases.test.ts`

**Interfaces:**
- Consumes: Task 2의 `AmdRepository`·`parseModuleRef`, Task 3의 `amdCalls`
- Produces: `amdRefsOf(component, name)`, `ResolveAmdDefinition.run(text, atIndex)`, `ListResolvedAmdCalls.run(text)`, `FindAmdReferences.run(component, name)`

- [ ] **Step 1: 사용처 색인 테스트 작성** — 기존 파일의 관례를 따라, `js_call_amd`를 담은 임시 PHP 텍스트를 `updateFileText`로 넣고 `amdRefsOf`가 위치를 주는지, 재호출 시 중복되지 않는지 확인한다.

```ts
  it('js_call_amd 사용처를 위치와 함께 담고, 같은 파일 재갱신에 중복되지 않는다', () => {
    const idx = new PhpUsageIndex(() => true);
    const uri = '/w/local/x/index.php';
    const text = `<?php\n$PAGE->requires->js_call_amd('local_x/mod', 'init');\n`;
    idx.updateFileText(uri, text);
    const refs = idx.amdRefsOf('local_x', 'mod');
    assert.equal(refs.length, 1);
    assert.equal(refs[0].line, 1);
    assert.equal(text.split('\n')[1].slice(refs[0].column, refs[0].column + 'local_x/mod'.length), 'local_x/mod');
    idx.updateFileText(uri, text);
    assert.equal(idx.amdRefsOf('local_x', 'mod').length, 1);
  });

  it('참조가 사라지면 목록에서 빠진다', () => {
    const idx = new PhpUsageIndex(() => true);
    idx.updateFileText('/w/a.php', `<?php\n$PAGE->requires->js_call_amd('local_x/mod', 'init');\n`);
    idx.updateFileText('/w/a.php', '<?php\n');
    assert.equal(idx.amdRefsOf('local_x', 'mod').length, 0);
  });
```

- [ ] **Step 2: 유즈케이스 테스트 작성** — `template-usecases.test.ts`와 같은 E2E 방식(실제 tree-sitter + mini-moodle 픽스처).

```ts
const root = join(__dirname, '../../fixtures/mini-moodle');
const amd = new AmdIndex(); amd.buildFromRoot(root);
const CODE = `<?php\nfunction p() {\n  $PAGE->requires->js_call_amd('local_ubattend/setting', 'init');\n  $PAGE->requires->js_call_amd('local_ubattend/nope', 'init');\n}\n`;

describe('AMD 유즈케이스 (E2E)', () => {
  let syn: TreeSitterPhpSyntax;
  before(async () => { syn = await TreeSitterPhpSyntax.create(); });

  it('정의 이동: 색인된 모듈의 파일로', () => {
    const at = CODE.indexOf('local_ubattend/setting') + 3;
    const locs = new ResolveAmdDefinition(syn, amd).run(CODE, at);
    assert.equal(locs.length, 1);
    assert.ok(locs[0].location.uri.endsWith(join('amd', 'src', 'setting.js')));
  });
  it('정의 이동: 없는 모듈·ref 밖은 빈 배열', () => {
    const uc = new ResolveAmdDefinition(syn, amd);
    assert.deepEqual(uc.run(CODE, CODE.indexOf('local_ubattend/nope') + 3), []);
    assert.deepEqual(uc.run(CODE, CODE.indexOf('function p')), []);
  });
  it('해석 범위: 색인된 참조만', () => {
    const r = new ListResolvedAmdCalls(syn, amd).run(CODE);
    assert.equal(r.length, 1);
    assert.equal(r[0].length, 'local_ubattend/setting'.length);
  });
});
```

- [ ] **Step 3: 실패 확인** — Run: `npm run test:unit -- --grep AMD`

- [ ] **Step 4: 구현**

`php-usage-index.ts`: 정규식과 저장소를 템플릿과 같은 모양으로 추가한다.
```ts
const AMD_USAGE_RE = /js_call_amd\(\s*['"]([\w:./-]+)['"]/g;
```
`byAmdRef: Map<string, SourceLocation[]>`, `amdByFile: Map<string, AmdEntry[]>`, `addAmdEntry`/`removeAmdEntry`, `amdRefsOf(component, name)`는 `byAmdRef.get(`${component}/${name}`)`. `extractPhp`의 반환에 `aEntries`를 추가하고 `updateFileText`에서 이전 항목 제거 → 재추출 → 등록 순서를 템플릿 쪽과 동일하게 처리한다. 줄·컬럼은 기존과 같은 증분 계산(별도 커서 변수 3개).

유즈케이스 세 개는 템플릿 대응물(`resolve-template-definition.ts`·`list-resolved-template-calls.ts`·`find-template-references.ts`)을 그대로 따르고 `parseModuleRef`를 쓴다.

- [ ] **Step 5: 통과 확인** — Run: `npm run test:unit`

- [ ] **Step 6: 커밋**
```bash
git commit -m "feat(app): AMD 정의·하이라이트 범위·사용처 참조 유즈케이스"
```

---

### Task 5: 프로바이더 결선 + 설정 + 문서 + 버전

**Files:**
- Create: `src/presentation/providers/amd-definition-provider.ts`, `src/presentation/providers/amd-reference-provider.ts`
- Modify: `src/extension.ts`, `package.json`, `README.md`, `CHANGELOG.md`, `docs/PHASE2-BACKLOG.md`, `docs/manual-verification.md`
- Test: `test/unit/presentation/highlight-sources.test.ts`

- [ ] **Step 1: 하이라이트 라우팅 테스트 갱신** — 픽스처 `sources`에 `{ setting: 'amd.highlightResolved', languages: ['php'] }`를 추가하고 php 기대 개수를 3 → 4로 고친다. 독립성 케이스도 추가한다.

```ts
  it('AMD 하이라이트는 다른 설정과 독립이다', () => {
    const r = pick(sources, 'php', { [S]: false, [T]: false, [B]: false });
    assert.deepEqual(r.map(s => s.setting), [A]);
  });
```

- [ ] **Step 2: 프로바이더 작성** — 정의 프로바이더는 `TemplateDefinitionProvider`와 동일 형태. 참조 프로바이더는 `TemplateReferenceProvider`를 따라 lazy 빌드 훅과 파일→`{component,name}` 역산 콜백을 받는다.

- [ ] **Step 3: `extension.ts` 결선**

- `AmdIndex` 인스턴스 생성, `buildAll`에 `await amd.buildFromRootAsync(root)` 추가
- 유즈케이스 3개 생성, php 정의 프로바이더 등록
- 참조 프로바이더 등록: `{ scheme: 'file', pattern: '**/amd/src/**/*.js' }`, 역산은 `componentOfAmdFile(root, file)`
- 하이라이트 소스에 `{ setting: 'amd.highlightResolved', languages: ['php'], run: t => listResolvedAmd.run(t) }`
- 워처 `**/amd/src/**/*.js` → `applyIncremental`로 `updateFile`/`removeFile`, 역산 null이면 `false`(침묵)

- [ ] **Step 4: 설정 기여** — `package.json`
```json
"csmscode.amd.highlightResolved": {
  "type": "boolean", "default": true,
  "description": "해석되는 AMD 모듈 참조(js_call_amd의 첫 인자)를 링크 색상(textLink.foreground)으로 하이라이팅합니다."
}
```

- [ ] **Step 5: 문서**

- `README.md`: 기능 한 줄 + 설정 표 행 추가.
- `docs/manual-verification.md`: `js_call_amd` F12(중첩 경로·코어 서브시스템 각 1회), 모듈 파일에서 Shift+F12, 없는 모듈에 무반응, 하이라이트 설정 off 확인.
- `docs/PHASE2-BACKLOG.md`: 알려진 제한에 겹따옴표 미지원(실측 2건)·구버전(3.5·2.9)에서 코어 서브시스템 모듈 침묵을 적고, 후속 항목으로 JS의 `import`/`require` 이동(1,161건·97%)과 `lib/components.json`의 `plugintypes`로 `PLUGIN_DIRS`를 대체하는 안(백로그 6번 잔여를 한 번에 해소)을 남긴다.
- `CHANGELOG.md`: `## [0.6.0] — 2026-08-06` 추가·변경 항목.

- [ ] **Step 6: 버전** — `package.json`의 `version`을 `0.6.0`으로.

- [ ] **Step 7: 최종 검증** — Run: `npm run test:unit && npm run lint && npm run compile && npx tsc -p tsconfig.test.json --noEmit`

- [ ] **Step 8: 커밋**
```bash
git add -A
git commit -m "feat: AMD 모듈 이동·참조 결선 + 문서 + 0.6.0"
```
