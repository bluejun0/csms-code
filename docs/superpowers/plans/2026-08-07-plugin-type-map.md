# 플러그인 타입 맵 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 플러그인 타입 → 디렉터리 매핑을 Moodle 자신의 선언(`lib/components.json`, `db/subplugins.json|php`)에서 읽어, 손으로 관리하던 30개 상수를 대체한다.

**Architecture:** 맵 구성은 새 모듈 `plugin-type-map.ts`가 맡고 루트별로 메모이즈한다. `moodle-root-resolver.ts`의 네 열거와 경로 역산은 상수 대신 이 맵을 쓴다. 정적 맵은 선언이 없는 구버전용 폴백으로 남는다.

**Tech Stack:** TypeScript, mocha + ts-node, VS Code API.

## Global Constraints

- 설계 문서: `docs/superpowers/specs/2026-08-07-plugin-type-map-design.md`. 충돌 시 설계 문서가 우선.
- 계층 규칙(eslint 강제): `domain/`은 fs·vscode·infrastructure 금지, `application/`은 infrastructure 금지.
- **주석은 객관적으로만**: 날짜·리뷰·계획 번호·변경 이력 서술 금지.
- 열거·역산 **규칙 자체는 바꾸지 않는다** — 맵의 출처만 바꾼다.
- 기존 261건 무회귀.

---

### Task 1: 타입 맵 모듈

**Files:**
- Create: `src/infrastructure/workspace/plugin-type-map.ts`
- Create(픽스처): **새 루트** `test/fixtures/subplugin-moodle/` (mini-moodle은 건드리지 않는다)
- Test: `test/unit/infra/plugin-type-map.test.ts`

**Interfaces:**
- Produces: `STATIC_PLUGIN_DIRS`, `pluginTypeDirs(root)`, `pluginTypeDirsAsync(root)`, `clearPluginTypeCache(root?)`

- [ ] **Step 1: 픽스처 추가 — 새 루트를 만든다**

`mini-moodle`은 여러 테스트가 **전체 목록을 `deepEqual`로 고정**하고 있어(설치 XML 컴포넌트 3개, lang 7개, AMD 6개 등) 여기에 서브플러그인을 넣으면 그 단언들이 한꺼번에 깨진다. 그 단언들은 일부러 조인 것이므로 느슨하게 바꾸지 말고, 이 시나리오 전용 루트를 새로 만든다.

`test/fixtures/subplugin-moodle/`:
- `version.php`, `lib/db/install.xml`(루트 인정 조건)
- `lib/components.json`: `{ "plugintypes": { "local": "local", "mod": "mod", "block": "blocks" }, "subsystems": { "form": "lib/form", "access": null } }`
- `mod/testmod/db/subplugins.json`: `{ "plugintypes": { "testsub": "mod/testmod/sub" } }`
- `mod/testmod/sub/alpha/`에 `db/install.xml`(TABLE 하나)·`lang/en/testsub_alpha.php`·`templates/card.mustache`·`amd/src/alpha.js` — 네 색인이 모두 새 타입을 잡는지 본다
- `blocks/testblock/db/subplugins.php`: `<?php\n$subplugins = array('testold' => 'blocks/testblock/old');`
- `blocks/testblock/old/beta/lang/en/testold_beta.php`
- 선언이 정적 맵과 다른 디렉터리를 가리키는 타입 하나(예: `{ "plugintypes": { "report": "custom/report" } }`)를 `lib/components.json`에 넣어 "선언이 정적 맵을 이긴다"를 고정한다

mini-moodle의 `pluginTypeDirs`는 그 `components.json`이 정적 맵과 같은 디렉터리만 선언하므로 결과가 정적 맵과 동일해야 한다 — 이것도 테스트로 고정한다(기존 테스트 무회귀의 근거).

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
import { strict as assert } from 'assert';
import { join } from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { STATIC_PLUGIN_DIRS, pluginTypeDirs, pluginTypeDirsAsync, clearPluginTypeCache }
  from '../../../src/infrastructure/workspace/plugin-type-map';

const root = join(__dirname, '../../fixtures/subplugin-moodle');

describe('pluginTypeDirs', () => {
  beforeEach(() => clearPluginTypeCache());

  it('선언 파일이 없으면 정적 맵과 같다', () => {
    const tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-types-'));
    assert.deepEqual([...pluginTypeDirs(tmp)].sort(), Object.entries(STATIC_PLUGIN_DIRS).sort());
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('subplugins.json의 타입을 더한다', () => {
    assert.equal(pluginTypeDirs(root).get('testsub'), 'mod/testmod/sub');
  });

  it('subplugins.php의 리터럴 쌍도 읽는다', () => {
    assert.equal(pluginTypeDirs(root).get('testold'), 'blocks/testblock/old');
  });

  it('정적 맵의 타입은 모두 유지된다(선언이 덮어쓴 것 제외)', () => {
    const map = pluginTypeDirs(root);
    for (const [t, d] of Object.entries(STATIC_PLUGIN_DIRS)) {
      assert.ok(map.has(t), `${t} 유지되어야 함`);
      if (t !== 'report') assert.equal(map.get(t), d, `${t}의 디렉터리가 바뀌면 안 된다`);
    }
  });

  it('선언이 정적 맵을 이긴다', () => {
    assert.equal(pluginTypeDirs(root).get('report'), 'custom/report');
  });

  it('mini-moodle은 정적 맵과 동일하다(기존 테스트 무회귀 근거)', () => {
    const mini = join(__dirname, '../../fixtures/mini-moodle');
    assert.deepEqual([...pluginTypeDirs(mini)].sort(), Object.entries(STATIC_PLUGIN_DIRS).sort());
  });

  it('동기 ≡ 비동기', async () => {
    const s = [...pluginTypeDirs(root)].sort();
    clearPluginTypeCache();
    const a = [...await pluginTypeDirsAsync(root)].sort();
    assert.deepEqual(a, s);
  });

  it('캐시: 같은 루트는 재구성하지 않는다(파일을 지워도 결과 유지)', () => {
    const tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-cache-'));
    fs.mkdirSync(join(tmp, 'lib'), { recursive: true });
    fs.writeFileSync(join(tmp, 'lib', 'components.json'), JSON.stringify({ plugintypes: { zzz: 'zzz' } }));
    assert.ok(pluginTypeDirs(tmp).has('zzz'));
    fs.rmSync(join(tmp, 'lib', 'components.json'));
    assert.ok(pluginTypeDirs(tmp).has('zzz'), '캐시가 유지되어야 함');
    clearPluginTypeCache(tmp);
    assert.ok(!pluginTypeDirs(tmp).has('zzz'), '캐시를 비우면 다시 읽는다');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('파손된 JSON·리터럴 없는 php는 무시한다', () => {
    const tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-bad-'));
    fs.mkdirSync(join(tmp, 'lib'), { recursive: true });
    fs.writeFileSync(join(tmp, 'lib', 'components.json'), '{ not json');
    fs.mkdirSync(join(tmp, 'local', 'x', 'db'), { recursive: true });
    fs.writeFileSync(join(tmp, 'local', 'x', 'db', 'subplugins.php'),
      '<?php $subplugins = (array) json_decode(file_get_contents($CFG->dirroot."/x.json"))->plugintypes;');
    assert.deepEqual([...pluginTypeDirs(tmp)].sort(), Object.entries(STATIC_PLUGIN_DIRS).sort());
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
```

- [ ] **Step 3: 실패 확인** — Run: `npm run test:unit -- --grep pluginTypeDirs`

- [ ] **Step 4: 구현**

```ts
import * as fs from 'fs';
import * as path from 'path';

/** 선언 파일이 없는 Moodle 버전용 폴백. 값이 있는 쪽이 이기므로 여기 없는 타입도 선언에서 채워진다. */
export const STATIC_PLUGIN_DIRS: Record<string, string> = { /* 기존 PLUGIN_DIRS 내용 그대로 */ };

// `$subplugins = array('type' => 'root/relative/dir', …)` 의 리터럴 쌍. PHP를 실행하지 않는다.
// 매칭 전에 `$subplugins` 첫 등장 위치부터 잘라낸다 — GPL 헤더·docblock의 따옴표 쌍을 배제한다.
const SUBPLUGIN_PHP_RE = /'(\w+)'\s*=>\s*'([\w/-]+)'/g;
const MAX_ROUNDS = 3;   // 서브플러그인의 서브플러그인까지. 실측 2회면 더 늘지 않는다.

const cache = new Map<string, Map<string, string>>();

export function clearPluginTypeCache(root?: string): void {
  if (root === undefined) cache.clear(); else cache.delete(root);
}

export function pluginTypeDirs(root: string): Map<string, string> {
  const hit = cache.get(root);
  if (hit) return hit;
  const map = new Map(Object.entries(STATIC_PLUGIN_DIRS));
  mergeComponents(map, readTextSync(path.join(root, 'lib', 'components.json')));
  // 라운드마다 전체를 다시 훑으면 플러그인당 readdir + existsSync 2회가 헛돈다 —
  // 직전 라운드에서 새로 생긴 디렉터리만 본다.
  let frontier = [...new Set(map.values())];
  for (let round = 0; round < MAX_ROUNDS && frontier.length; round++) {
    const added: string[] = [];
    for (const dir of frontier) {
      for (const name of safeDirsSync(path.join(root, dir))) {
        const base = path.join(root, dir, name, 'db');
        const json = readTextSync(path.join(base, 'subplugins.json'));
        if (json !== null) { mergeComponents(map, json); continue; }
        mergePhp(map, readTextSync(path.join(base, 'subplugins.php')));
      }
    }
    frontier = added;
  }
  cache.set(root, map);
  return map;
}
```
`mergeComponents(map, text)`는 `text`가 null이면 아무것도 하지 않고, JSON을 파싱해 `plugintypes`의 문자열 값만 `map.set`한다(파싱 실패는 무시). `mergeComponents`는 `components.json`과 `subplugins.json`이 같은 `plugintypes` 형태라 그대로 공유한다. `mergePhp(map, text)`는 정규식 쌍을 `map.set`한다.

비동기 판은 같은 구조에 `fs.promises` + `INDEX_YIELD_EVERY`마다 `yieldNow()`를 쓰고, 완성된 맵을 같은 캐시에 넣는다. 헬퍼(`readTextSync`/`safeDirsSync`의 비동기 짝)는 이 파일 안에 둔다 — 자원 열거 헬퍼는 resolver에도 있지만 서로 다른 실패 정책(여기서는 없으면 null)을 쓴다.

- [ ] **Step 5: 통과 확인** — Run: `npm run test:unit`

- [ ] **Step 6: 커밋**
```bash
git add src/infrastructure/workspace/plugin-type-map.ts test/fixtures/mini-moodle test/unit/infra/plugin-type-map.test.ts
git commit -m "feat(infra): 플러그인 타입 맵을 Moodle 선언에서 구성(정적 맵은 폴백)"
```

---

### Task 2: 열거·역산을 타입 맵으로 전환

**Files:**
- Modify: `src/infrastructure/workspace/moodle-root-resolver.ts`
- Test: `test/unit/infra/resolver.test.ts`

**Interfaces:**
- Consumes: Task 1의 `pluginTypeDirs`/`pluginTypeDirsAsync`
- Produces: `pluginTypeOfRel(root, rel)` — 시그니처 변경

- [ ] **Step 1: 실패하는 테스트 작성** — 새 타입이 네 색인에 모두 나타나고, 역산이 서브플러그인 타입으로 정밀해지는지.

```ts
describe('MoodleRootResolver — 선언에서 온 서브플러그인 타입', () => {
  beforeEach(() => clearPluginTypeCache());

  it('install.xml 열거에 새 타입이 포함된다', () => {
    const list = listInstallXmlFiles(root).map(x => x.component);
    assert.ok(list.includes('testsub_alpha'), list.join(','));
  });
  it('lang 열거에 새 타입이 포함된다(구형식 php 선언 포함)', () => {
    const list = listLangFiles(root).map(x => x.component);
    assert.ok(list.includes('testsub_alpha'));
    assert.ok(list.includes('testold_beta'));
  });
  it('템플릿·AMD 열거에도 포함된다', () => {
    assert.ok(listTemplateFiles(root).some(x => x.component === 'testsub_alpha' && x.name === 'card'));
    assert.ok(listAmdFiles(root).some(x => x.component === 'testsub_alpha' && x.name === 'alpha'));
  });
  it('역산이 상위 타입이 아니라 서브플러그인 타입을 준다', () => {
    assert.equal(
      componentOfInstallXmlFile(root, join(root, 'mod/testmod/sub/alpha/db/install.xml')),
      'testsub_alpha');
    assert.deepEqual(
      componentOfAmdFile(root, join(root, 'mod/testmod/sub/alpha/amd/src/alpha.js')),
      { component: 'testsub_alpha', name: 'alpha' });
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run test:unit -- --grep 서브플러그인`

- [ ] **Step 3: 구현**

- `PLUGIN_DIRS` export를 제거하고, `Object.entries(PLUGIN_DIRS)`를 쓰던 자리(동기 4곳·비동기 4곳)를 `pluginTypeDirs(root)`/`await pluginTypeDirsAsync(root)`로 바꾼다. `Map`이므로 `for (const [type, relDir] of map)`이 그대로 성립한다.
- `pluginTypeOfRel(rel)` → `pluginTypeOfRel(root, rel)`. 본문의 `Object.entries(PLUGIN_DIRS)`만 `pluginTypeDirs(root)`로 바꾸고 최장 매치 로직은 그대로 둔다.
- 호출부 `componentOfInstallXmlFile`·`langFileMetaOf`·`componentOfTemplateFile`·`componentOfAmdFile`에 `root`를 넘긴다.
- `amdRoots`/`amdRootsAsync`도 같은 방식으로 바꾼다.

- [ ] **Step 4: 통과 확인** — Run: `npm run test:unit && npm run lint && npm run compile`

- [ ] **Step 5: 커밋**
```bash
git commit -m "feat(infra): 네 열거와 경로 역산이 타입 맵을 사용"
```

---

### Task 3: 캐시 무효화 결선 + 실측

**Files:**
- Modify: `src/extension.ts`
- Test: 없음(결선은 통합 테스트 영역) — 대신 실측을 수동 검증 문서에 남긴다

- [ ] **Step 1: 캐시를 미리 채우고, 비운 뒤에는 즉시 다시 채운다**

동기 `pluginTypeDirs`의 캐시 미스는 확장 호스트를 막는다(실측 구성 72ms~419ms). 역산은 F12·워처마다 불리므로 **미스 창을 열어두면 안 된다**.
- `activate()`에서 루트를 찾은 직후, 프로바이더 등록 전에 `await pluginTypeDirsAsync(root)`로 캐시를 채운다(양보하므로 UI를 막지 않는다).
- `gatedRebuild` 안에서는 `clearPluginTypeCache(root)` 직후 `await pluginTypeDirsAsync(root)`를 호출하고 나서 `buildAll()`을 시작한다 — 비운 상태로 노출되는 구간이 없어야 한다.
- 비동기 구성은 **진행 중 Promise를 캐시**해 동시 호출이 두 번 만들지 않게 한다.

- [ ] **Step 2: 선언 파일 워처**

```ts
  // 타입 맵 자체가 바뀌므로 파일 단위 증분이 불가능하다 — 캐시를 버리고 전체를 다시 만든다.
  const typeDeclWatcher = vscode.workspace.createFileSystemWatcher('**/db/subplugins.{json,php}');
  const componentsWatcher = vscode.workspace.createFileSystemWatcher('**/lib/components.json');
  const onTypeDecl = () => { clearPluginTypeCache(root); void gatedRebuild(); };
  ctx.subscriptions.push(typeDeclWatcher, componentsWatcher,
    typeDeclWatcher.onDidChange(onTypeDecl), typeDeclWatcher.onDidCreate(onTypeDecl), typeDeclWatcher.onDidDelete(onTypeDecl),
    componentsWatcher.onDidChange(onTypeDecl), componentsWatcher.onDidCreate(onTypeDecl), componentsWatcher.onDidDelete(onTypeDecl));
```
`gatedRebuild`는 이미 재진입을 `pendingReindex`로 흡수하므로 연달아 불려도 안전하다.

- [ ] **Step 3: 실측** — 스크래치패드 스크립트로 다음을 잰다.
  1. 타입 맵 구성 시간(동기·비동기)과 비동기 구성 중 최대 이벤트 루프 정지 — **콜드 캐시의 구버전 루트**(`inulms_cm3`, 실측 419ms 사례)에서도 잰다. hlulxp 웜만 재면 최악을 놓친다.
  2. 네 색인 크기 전후.
  3. `buildAll` **wall-clock 전후** — lang 파일이 hlulxp 기준 +148개(약 30% 증가)라 준비 시간이 늘어난다. 최대 정지가 한 자릿수여도 준비 시간은 별개이므로 따로 적는다.
  열거 시간 비교는 파일시스템 캐시 상태에 좌우되므로(같은 프로세스에서 두 번째 측정이 빨라진다) 문서에 쓰지 않는다.

- [ ] **Step 4: 검증** — Run: `npm run test:unit && npm run lint && npm run compile && npx tsc -p tsconfig.test.json --noEmit`

- [ ] **Step 5: 커밋**
```bash
git commit -m "feat(presentation): 선언 파일 변경 시 타입 맵 캐시 무효화 + 재색인"
```

---

### Task 4: 문서 + 버전

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `docs/PHASE2-BACKLOG.md`, `docs/manual-verification.md`, `package.json`

- [ ] **Step 1: 백로그 정리** — 6번(잔여 해소)·19번(완료)을 닫고, AMD 미해석 요인 ①을 지운다. `coreSubsystemDirs` 메모이즈가 이 사이클에서 함께 해결됐는지 확인해 기록한다(같은 캐시 구조를 쓰면 해소).
- [ ] **Step 2: README** — 워크스페이스 자동 인식 항목에 "플러그인 타입 매핑을 Moodle 선언(`lib/components.json`·`db/subplugins.*`)에서 읽는다"를 한 줄 추가.
- [ ] **Step 3: 수동 검증** — `mod/quiz/accessrule/seb`·`question/bank/*`·`lib/editor/tiny/plugins/*`의 lang·템플릿 기능이 동작하는지 확인 절차를 추가.
- [ ] **Step 4: CHANGELOG + 버전 0.7.0** — 실측 표(타입 30→65, 플러그인 +146 등)를 포함한다.
- [ ] **Step 5: 최종 검증 후 커밋**
```bash
git add -A && git commit -m "feat: 플러그인 타입 맵 문서화 + 0.7.0"
```
