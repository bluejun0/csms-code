# Moodle 전역 인텔리전스 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `$DB`·`$PAGE`·`$OUTPUT`은 코어 클래스 멤버로, `$CFG`는 설정 키로, `$USER`·`$COURSE`·`$SITE`는 테이블 컬럼으로 완성·hover·정의 이동을 제공한다.

**Architecture:** 도메인의 전역 표가 변수명 → 바인딩 종류를 정하고, 종류별 색인(클래스 멤버·설정 키·기존 테이블)이 후보를 공급한다. 유즈케이스 세 개가 종류를 분기하고 프리젠테이션은 기존 프로바이더 옆에 나란히 등록된다.

**Tech Stack:** TypeScript, web-tree-sitter(PHP WASM), mocha + ts-node, VS Code API.

## Global Constraints

- 설계 문서: `docs/superpowers/specs/2026-08-07-moodle-globals-design.md`. 충돌 시 설계가 우선.
- 계층 규칙(eslint): `domain/`은 fs·vscode·infrastructure 금지, `application/`은 infrastructure 금지.
- **진단은 만들지 않는다.**
- **주석은 객관적으로만**: 날짜·리뷰·계획 번호·이력 서술 금지.
- 픽스처는 `test/fixtures/mini-moodle`의 기존 `deepEqual` 목록을 깨지 않게 추가한다(코어 클래스 파일은 새 컴포넌트를 만들지 않으므로 안전하다 — 추가 후 전체 테스트로 확인).
- 기존 277건 무회귀.

---

### Task 1: 전역 표 + `methodCalls` 팩트

**Files:**
- Create: `src/domain/moodle-model/globals.ts`
- Modify: `src/domain/code-analysis/facts.ts`, `src/infrastructure/tree-sitter/tree-sitter-php-syntax.ts`
- Test: `test/unit/infra/tree-sitter.test.ts`, `test/unit/domain/globals.test.ts`

**Interfaces:**
- Produces: `MOODLE_GLOBALS`, `GlobalBinding`, `MethodCall`, `DocumentFacts.methodCalls`

- [ ] **Step 1: 실패하는 테스트**

```ts
// test/unit/domain/globals.test.ts
describe('MOODLE_GLOBALS', () => {
  it('클래스·테이블·설정 세 종류를 모두 담는다', () => {
    assert.deepEqual(MOODLE_GLOBALS.DB, { kind: 'class', className: 'moodle_database' });
    assert.deepEqual(MOODLE_GLOBALS.USER, { kind: 'table', tableName: 'user' });
    assert.deepEqual(MOODLE_GLOBALS.SITE, { kind: 'table', tableName: 'course' });
    assert.deepEqual(MOODLE_GLOBALS.CFG, { kind: 'config' });
  });
  it('전역이 아닌 이름은 없다', () => assert.equal(MOODLE_GLOBALS['rec'], undefined));
});
```
```ts
// tree-sitter.test.ts 말미
const CODE10 = `<?php
function q() {
  global $DB;
  $r = $DB->get_record('user', ['id' => 1]);
  $DB->update_record('user', $r);
  echo $USER->firstname;
  echo $PAGE->context;
}
`;
describe('TreeSitterPhpSyntax — methodCalls', () => {
  let syn: TreeSitterPhpSyntax; let f: any;
  before(async () => { syn = await TreeSitterPhpSyntax.create(); f = syn.facts(CODE10); });

  it('수신 변수와 메서드 이름을 위치와 함께 잡는다', () => {
    const calls = f.methodCalls.filter((c: any) => c.varName === 'DB').map((c: any) => c.method);
    assert.deepEqual(calls, ['get_record', 'update_record']);
    const first = f.methodCalls.find((c: any) => c.method === 'get_record');
    assert.equal(CODE10.slice(first.nameIndex, first.nameIndex + 'get_record'.length), 'get_record');
    assert.equal(first.nameLine, 3);
  });
  it('프로퍼티 접근은 methodCalls에 들어가지 않는다', () => {
    assert.ok(!f.methodCalls.some((c: any) => c.method === 'firstname' || c.method === 'context'));
    assert.ok(f.propertyAccesses.some((p: any) => p.property === 'firstname'));
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run test:unit -- --grep methodCalls`
- [ ] **Step 3: 구현** — `facts.ts`에 `MethodCall`·`methodCalls` 추가(`emptyFacts()` 포함), 쿼리 `Q_METHOD_CALL = (member_call_expression object: (variable_name (name) @var) name: (name) @method)`를 컴파일해 추출. 위치는 `@method` 노드의 `startPosition`·`startIndex`, `index`와 `scope`는 `@var` 기준.
- [ ] **Step 4: 통과 확인** — Run: `npm run test:unit`
- [ ] **Step 5: 커밋** — `feat(infra): 메서드 호출 팩트 + Moodle 전역 바인딩 표`

---

### Task 2: 클래스 멤버 색인

**Files:**
- Create: `src/domain/moodle-model/ports/class-member-repository.ts`, `src/infrastructure/coreapi/class-member-index.ts`
- Create(픽스처): `test/fixtures/mini-moodle/lib/dml/moodle_database.php`, `test/fixtures/mini-moodle/lib/pagelib.php`, `test/fixtures/mini-moodle/lib/outputrenderers.php`
- Test: `test/unit/infra/class-member-index.test.ts`

**Interfaces:**
- Consumes: `PhpSyntax`(파싱), Task 1의 팩트는 쓰지 않는다 — 클래스 본문 추출은 전용 쿼리가 필요하다
- Produces: `ClassMember`, `ClassMemberRepository.membersOf(className)`, `ClassMemberIndex`

- [ ] **Step 1: 픽스처** — 실제 구조를 최소로 흉내낸다.

`lib/dml/moodle_database.php`
```php
<?php
abstract class moodle_database {
    /** @var string 접두사 */
    public $prefix = '';
    /**
     * 레코드 하나를 가져온다.
     * 자세한 설명은 여기.
     */
    public function get_record($table, array $conditions) { }
    public function update_record($table, $dataobject) { }
    protected function internal_helper() { }
    private function secret() { }
}
```
`lib/pagelib.php`
```php
<?php
class moodle_page {
    /** 페이지 컨텍스트 */
    protected function magic_get_context() { }
    public function set_url($url) { }
}
```
`core_renderer`는 **두 번째 후보에만** 둔다 — `lib/classes/output/core_renderer.php`는 만들지 않고(또는 선언 없는 껍데기로 두고) `lib/outputrenderers.php`에 `class core_renderer`를 둔다(3.9 배치). 첫 후보가 빗나가고 두 번째가 맞아야 폴백 로직이 실제로 검증된다. 첫 후보에 두면 폴백을 지워도 테스트가 통과한다.

픽스처를 추가한 **직후 전체 테스트를 돌려** 기존 `deepEqual` 목록이 그대로인지 먼저 확인한다(색인 코드를 쓰기 전에 확인해야 원인이 분명하다).

- [ ] **Step 2: 실패하는 테스트**

```ts
const root = join(__dirname, '../../fixtures/mini-moodle');
describe('ClassMemberIndex', () => {
  let idx: ClassMemberIndex;
  before(async () => {
    const syn = await TreeSitterPhpSyntax.create();
    idx = new ClassMemberIndex();
    await idx.buildFromRootAsync(root, syn);
  });

  it('public 메서드와 프로퍼티를 담는다', () => {
    const names = idx.membersOf('moodle_database').map(m => m.name).sort();
    assert.deepEqual(names, ['get_record', 'prefix', 'update_record']);
  });
  it('private·protected는 제외한다', () => {
    assert.ok(!idx.membersOf('moodle_database').some(m => m.name === 'secret'));
    assert.ok(!idx.membersOf('moodle_database').some(m => m.name === 'internal_helper'));
  });
  it('magic_get_x는 프로퍼티 x가 된다', () => {
    const ctx = idx.membersOf('moodle_page').find(m => m.name === 'context');
    assert.ok(ctx, 'context 프로퍼티가 있어야 한다');
    assert.equal(ctx!.kind, 'property');
  });
  it('시그니처와 phpdoc 첫 문장을 담는다', () => {
    const m = idx.membersOf('moodle_database').find(x => x.name === 'get_record')!;
    assert.equal(m.kind, 'method');
    assert.match(m.signature, /\$table/);
    assert.equal(m.doc, '레코드 하나를 가져온다.');
  });
  it('위치가 선언 줄을 가리킨다', () => {
    const m = idx.membersOf('moodle_database').find(x => x.name === 'get_record')!;
    const text = fs.readFileSync(m.location.uri, 'utf8').split('\n')[m.location.line];
    assert.match(text, /function get_record/);
  });
  it('첫 후보에 클래스가 없으면 다음 후보로 넘어간다', () => {
    const members = idx.membersOf('core_renderer');
    assert.ok(members.length > 0, '두 번째 후보에서 찾아야 한다');
    assert.ok(members[0].location.uri.endsWith('outputrenderers.php'));
  });
  it('없는 클래스는 빈 목록', () => assert.deepEqual(idx.membersOf('nope'), []));
});
```

- [ ] **Step 3: 실패 확인** — Run: `npm run test:unit -- --grep ClassMemberIndex`
- [ ] **Step 4: 구현**

포트는 `membersOf(className): ClassMember[]` 하나다. 색인은 후보 표를 상수로 두고
```ts
const CLASS_FILES: Record<string, string[]> = {
  moodle_database: ['lib/dml/moodle_database.php'],
  moodle_page: ['lib/pagelib.php'],
  core_renderer: ['lib/classes/output/core_renderer.php', 'lib/outputrenderers.php'],
};
```
각 클래스마다 후보를 순서대로 읽어 `new RegExp(`(class|interface|trait)\\s+${name}\\b`)`가 맞는 첫 파일을 고른다. 그 파일은 팩트가 아니라 클래스 본문을 봐야 하므로 전용 추출이 필요하다.

```ts
// tree-sitter-php-syntax.ts
export interface RawClassMember {
  name: string; kind: 'method' | 'property'; visibility: string;
  signature: string; docLine: number; line: number; column: number;
}
classMembers(text: string, className: string): RawClassMember[]
```
이 메서드는 **`PhpSyntax` 포트에 추가한다** — 인프라끼리 직접 붙이면 가짜로 테스트할 수 없고 WASM에 묶인다. `CachedPhpSyntax`는 `facts`만 감싸므로 **`classMembers` 패스스루를 반드시 추가**한다(빠뜨리면 색인이 조용히 비어버린다).

쿼리는 클래스 선언을 찾고(`(class_declaration name: (name) @cls body: (declaration_list) @body)`), 이름이 맞는 body 안에서 `method_declaration`·`property_declaration`을 훑는다. 가시성은 `modifier`(없으면 `public`), phpdoc은 선언 직전 형제 `comment`에서 첫 문장(`.`·`。`·줄바꿈 전까지)만 취한다. `magic_get_` 접두 메서드는 `kind: 'property'`, 이름은 접두사를 뗀 것으로 바꾼다.

- [ ] **Step 5: 폴백 확인(변이 주입)** — 후보 루프의 "선언 없으면 다음 후보" 분기를 제거하면 위 테스트가 실패하는지 확인한다.
- [ ] **Step 6: 실측** — hlulxp에서 세 클래스 파싱의 wall-clock과 최대 이벤트 루프 정지를 잰다. 설계대로 **지연 빌드**이므로 활성화 경로에는 들어가지 않지만, 첫 요청의 체감 지연을 기록해 문서에 쓴다. 한 자릿수 ms로 나오면 그때 활성화 빌드로 옮긴다.
- [ ] **Step 6: 커밋** — `feat(infra): 코어 클래스 멤버 색인`

---

### Task 3: 설정 키 색인

**Files:**
- Create: `src/domain/moodle-model/ports/config-key-repository.ts`, `src/infrastructure/config/config-key-index.ts`
- Create(픽스처): `test/fixtures/mini-moodle/config-dist.php`, `test/fixtures/mini-moodle/local/ubattend/settings.php`
- Test: `test/unit/infra/config-key-index.test.ts`

- [ ] **Step 1: 픽스처**
```php
// config-dist.php
<?php
// 사이트 주소.
$CFG->wwwroot   = 'http://example.com/moodle';
$CFG->dataroot  = '/home/example/moodledata';
```
```php
// local/ubattend/settings.php
<?php
$settings->add(new admin_setting_configtext('local_ubattend/attendlimit', '출석 상한', '설명', 10));
$settings->add(new admin_setting_configcheckbox('ubattend_simple', '단순 모드', '', 0));
```

- [ ] **Step 2: 실패하는 테스트**
```ts
describe('ConfigKeyIndex', () => {
  let idx: ConfigKeyIndex;
  before(async () => { idx = new ConfigKeyIndex(); await idx.buildFromRootAsync(root); });

  it('config-dist.php의 키를 담는다', () => {
    assert.ok(idx.find('wwwroot'));
    assert.ok(idx.find('dataroot'));
  });
  it('admin_setting 선언에서 키를 담고 plugin/key는 마지막 조각을 쓴다', () => {
    assert.ok(idx.find('attendlimit'));
    assert.ok(idx.find('ubattend_simple'));
  });
  it('위치가 선언 줄을 가리킨다', () => {
    const k = idx.find('wwwroot')!;
    const line = fs.readFileSync(k.location.uri, 'utf8').split('\n')[k.location.line];
    assert.match(line, /wwwroot/);
  });
  it('없는 키는 undefined', () => assert.equal(idx.find('nope_key'), undefined));
});
```

- [ ] **Step 3: 실패 확인** — Run: `npm run test:unit -- --grep ConfigKeyIndex`
- [ ] **Step 4: 구현** — `config-dist.php`는 `/\$CFG->(\w+)/g`, `settings.php`는 `/new\s+admin_setting_\w+\s*\(\s*'([\w/]+)'/g`. 줄·컬럼은 기존 증분 계산 관례를 따른다. `settings.php` 열거는 타입 맵(`pluginTypeDirs`)으로 플러그인 디렉터리를 돌고 `admin/settings/*.php`를 더한다. 같은 이름이 여러 번 나오면 먼저 찾은 것을 유지한다.
- [ ] **Step 5: 커밋** — `feat(infra): 설정 키 색인(config-dist + admin_setting 선언)`

---

### Task 4: 유즈케이스 3종

**Files:**
- Create: `src/application/complete-global-members.ts`, `describe-global-member.ts`, `resolve-global-member-definition.ts`
- Modify: `src/application/dto.ts` (`GlobalMemberItem`)
- Test: `test/unit/application/global-usecases.test.ts`

- [ ] **Step 1: 실패하는 테스트** — 세 종류 각각의 완성, 전역이 아닌 변수의 빈 결과, hover가 메서드 이름·프로퍼티 이름 양쪽에서 동작, 정의 이동이 클래스 파일·config-dist·install.xml로 가는지. 픽스처 루트와 실제 tree-sitter를 쓰는 E2E로 쓴다(템플릿·AMD 유즈케이스 테스트와 같은 방식).
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**

```ts
export interface GlobalMemberItem { name: string; detail: string; doc: string; kind: 'method' | 'property' | 'field'; }

export class CompleteGlobalMembers {
  constructor(private classes: ClassMemberRepository, private tables: TableRepository,
              private configs: ConfigKeyRepository) {}
  run(text: string, varName: string, atIndex: number): GlobalMemberItem[] {
    const g = MOODLE_GLOBALS[varName];
    if (!g) return [];
    if (g.kind === 'class') return this.classes.membersOf(g.className).map(…);
    if (g.kind === 'config') return this.configs.keys().map(…);
    // 같은 스코프에서 이 이름에 대입이 있었다면 전역이 아니다 — 레코드 엔진이 담당한다.
    if (shadowed(this.syntax.facts(text), varName, atIndex)) return [];
    return this.tables.getTable(g.tableName)?.fields.map(…) ?? [];
  }
}
```
`class`·`config` 종류는 변수명만으로 정해지고, `table` 종류만 가림 판정을 위해 팩트를 본다(설계 §3.4.1). 가림 테스트를 반드시 넣는다 — `foreach ($users as $USER)`와 `$COURSE = $DB->get_record('course_modules', …)` 두 경우에 빈 결과여야 한다. hover·정의 이동은 `facts.propertyAccesses`와 `facts.methodCalls`에서 커서 위치를 찾아 같은 분기를 탄다.

- [ ] **Step 4: 통과 확인 + 커밋** — `feat(app): 전역 완성·hover·정의 이동 유즈케이스`

---

### Task 5: 결선 + 문서 + 0.8.0

**Files:**
- Create: `src/presentation/providers/global-member-completion-provider.ts`, `global-hover-provider.ts`, `global-definition-provider.ts`
- Modify: `src/extension.ts`, `README.md`, `CHANGELOG.md`, `docs/PHASE2-BACKLOG.md`, `docs/manual-verification.md`, `package.json`

- [ ] **Step 1: 프로바이더** — 완성 프로바이더는 기존 레코드 프로바이더와 같은 줄 정규식(`/\$(\w+)->(\w*)$/`)을 쓰고 트리거는 `>`. 메서드는 `CompletionItemKind.Method`, 프로퍼티·컬럼은 `Field`. `moodle_database`만 101개라 **정렬을 지정한다** — 실측 상위 메서드(`get_record`·`get_records`·`get_records_sql`·`get_record_sql`·`insert_record`·`update_record`·`get_field_sql`·`delete_records`·`execute`)에 앞서는 `sortText`를 주고 나머지는 이름순.
- [ ] **Step 2: `extension.ts` 결선** — 색인 두 개를 만들고 `buildAll`에 추가, php에 프로바이더 3종 등록. 클래스 색인은 tree-sitter 어댑터가 필요하므로 `syntax` 생성 이후에 만든다.
- [ ] **Step 3: 실측** — 활성화 전체 빌드 wall-clock·최대 이벤트 루프 정지를 **웜 2회**로 재고 CHANGELOG에 적는다(콜드 값은 쓰지 않는다).
- [ ] **Step 4: 문서** — README 기능 한 줄, 수동 검증 항목(각 전역 하나씩), 백로그 15번 완료 처리, CHANGELOG `## [0.8.0]`.
- [ ] **Step 5: 최종 검증** — `npm run test:unit && npm run lint && npm run compile && npx tsc -p tsconfig.test.json --noEmit`
- [ ] **Step 6: 커밋** — `feat: 전역 인텔리전스 결선 + 문서 + 0.8.0`
