# 색인 계층 메모리 구현 계획 (2단계)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용처 색인이 붙잡고 있는 파일 텍스트를 없애 창당 보유 메모리를 131 MB에서 23 MB 이하로 낮춘다.

**Architecture:** 정규식 캡처는 원본을 가리키는 조각이라, 보관하면 파일 전체가 살아남는다. 문자열 풀을 하나 두고 넣을 때 사본을 만들며, 저장 구조가 문자열 대신 `StringId`(수치)만 받게 한다. 그러면 사본을 만들지 않은 조각은 타입 검사에서 걸려 들어올 수 없다. 도메인 타입 `SourceLocation`은 조회 경계에서 풀로부터 되살린다.

**Tech Stack:** TypeScript, mocha + ts-node

**Spec:** `docs/superpowers/specs/2026-09-03-parser-rewrite-design.md` §5

## Global Constraints

- **주석은 한국어로 쓴다.** 최소로 쓰되, 코드에서 읽어낼 수 없는 사실(불변식, 왜 대안이 안 되는지)은 예외로 남긴다.
- **주석에 날짜·리뷰 참조·태스크 번호·백로그 번호를 쓰지 않는다.**
- `PhpUsageIndex`의 공개 표면은 바꾸지 않는다: `isBuilt`, `buildFromRoot`, `updateFileText`, `toSnapshot`, `loadSnapshot`, `revalidateFromRoot`, `referencesOf`, `templateRefsOf`, `amdRefsOf`, `configRefsOf`, `tableRefsOf`. 조회 메서드는 계속 `SourceLocation[]`을 돌려준다.
- 기존 `php-usage-index`·`usage-snapshot`·`usage-index-cache` 테스트가 하나도 줄지 않고 그대로 통과해야 한다.
  `.mocharc.json`의 `spec`이 고정이라 파일 하나만 돌리는 방법이 없다 — 전체 스위트 통과 수로 확인한다.
- 도메인 스캐너(`scanJsCalls`, `scanMustache`)는 문자열을 돌려주는 그대로 둔다 — 도메인은 풀을 몰라야 한다. 풀 경계는 색인이 그 결과를 소비하는 자리다.
- 스냅샷 포맷(`SNAPSHOT_VERSION = 2`)은 바꾸지 않는다. 저장·복원 시 경계에서 문자열↔id로 변환한다.
  (근거 정정: 이렇게 해도 사용자의 기존 캐시는 살아남지 않는다 — `isSnapshotUsable`이 확장 버전도 검사하므로
  버전이 오르면 포맷과 무관하게 무효화된다. 포맷을 유지하는 실제 이득은 변경 범위가 작다는 것이다.)
- 모듈 스코프 정규식은 건드리지 않는다 — 대상 문자열을 붙잡지 않는 것이 측정으로 확인됐다.
- 각 태스크는 `npx tsc -noEmit`·`npm run test:unit`·`npm run lint`가 통과하고 `git status`가 깨끗한 상태로 끝난다.
- 수정 라운드에서도 **새 커밋**을 만든다. `git commit --amend`를 쓰지 않는다.
- 실측 코퍼스는 `~/workspace/csms45`. 환경 변수가 없으면 그 테스트는 건너뛴다.

## 기준선 (실측, csms45 24,890 파일)

| | 보유 | 빌드 |
|---|---|---|
| 현재 | 131 MB | 6.3 s |
| 캡처 평탄화만 | 25.5 MB | 5.9 s |
| 평탄화 + 풀 | **22.8 MB** | 5.4 s |

항목 89,897개 · 도장 24,890개 · 게시 목록 최상위 키 5,253개 · 고유 문자열 32,630개
(키 20,229 · uri 7,148 · 템플릿 1,890 · 테이블 1,442 · 설정 961 · 컴포넌트 577 · AMD 383).

## 파일 구성

| 파일 | 책임 |
|---|---|
| `src/infrastructure/usage/string-pool.ts` (새로) | 문자열 ↔ `StringId`. 넣을 때 사본을 만든다 |
| `src/infrastructure/usage/usage-entries.ts` (새로) | id 기반 항목 타입과 빈 추출 결과 |
| `src/infrastructure/usage/extract-usages.ts` (새로) | PHP·JS·mustache 추출기. `StringId`만 담아 돌려준다 |
| `src/infrastructure/usage/php-usage-index.ts` (수정) | 보관·조회·파일 단위 교체·스냅샷. 추출 로직은 위로 옮긴다 |

스펙 §5.1은 여기에 더해 `usage-store.ts`·`workspace-scan.ts`·`snapshot.ts`로 더 쪼개는 구성을 적고 있다.
이번 범위에서는 쪼개지 않는다 — 이 계획의 목적은 메모리이고, 강제는 파일 경계가 아니라 **타입**에서 나온다
(항목의 문자열 자리가 전부 `StringId`이므로 풀을 지나지 않은 값은 담길 수 없다). 열거·스냅샷을 파일로 나누는 것은
메모리에 기여하지 않으면서 diff만 키운다. 스펙 §6(3단계)이 순회와 스냅샷을 다룰 때 함께 정리한다.

---

### Task 1: 문자열 풀

**Files:**
- Create: `src/infrastructure/usage/string-pool.ts`
- Test: `test/unit/infra/string-pool.test.ts`

**Interfaces:**
- Produces: `type StringId = number`; `class StringPool` with `id(value: string): StringId`, `find(value: string): StringId | undefined`, `text(id: StringId): string`, `get size(): number`

**왜 사본이 필요한가** — V8에서 정규식 캡처는 부모 문자열을 가리키는 조각(sliced string)이라, 조각 하나를 보관하면 파일 전체가 살아남는다. 실측: 8 MB 텍스트 5개에서 185자만 보관했을 때 40.0 MB가 남았고, `Buffer` 왕복으로 사본을 만들면 0.0 MB가 남았다.

**가장 틀리기 쉬운 지점** — Map의 **키도 사본이어야 한다**. 조각을 키로 넣으면 풀이 그 조각을 통해 파일을 계속 붙잡는다. 실측: 사본 없이 Map 인터닝만 하면 40 MB 중 32 MB가 그대로 남았다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// test/unit/infra/string-pool.test.ts
import { strict as assert } from 'assert';
import { StringPool } from '../../../src/infrastructure/usage/string-pool';

describe('StringPool', () => {
  it('같은 값은 같은 id', () => {
    const pool = new StringPool();
    assert.equal(pool.id('local_ubion'), pool.id('local_ubion'));
    assert.equal(pool.size, 1);
  });

  it('다른 값은 다른 id', () => {
    const pool = new StringPool();
    assert.notEqual(pool.id('a'), pool.id('b'));
    assert.equal(pool.size, 2);
  });

  it('id로 원래 값을 되찾는다', () => {
    const pool = new StringPool();
    const id = pool.id('get_string');
    assert.equal(pool.text(id), 'get_string');
  });

  it('find는 없는 값에 id를 만들지 않는다', () => {
    const pool = new StringPool();
    pool.id('있는값');
    assert.equal(pool.find('없는값'), undefined);
    assert.equal(pool.size, 1);
  });

  it('find는 있는 값의 id를 준다', () => {
    const pool = new StringPool();
    const id = pool.id('있는값');
    assert.equal(pool.find('있는값'), id);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx mocha test/unit/infra/string-pool.test.ts`
Expected: FAIL — `Cannot find module '.../string-pool'`

- [ ] **Step 3: 구현한다**

```ts
// src/infrastructure/usage/string-pool.ts
export type StringId = number;

export class StringPool {
  private readonly ids = new Map<string, StringId>();
  private readonly texts: string[] = [];

  // 정규식 캡처는 원본 문자열을 가리키는 조각이라, 사본을 만들지 않고 보관하면 파일 전체가 살아남는다.
  // 사본은 Map의 키로도 써야 한다 — 조각을 키로 넣으면 풀이 그 조각을 통해 파일을 붙잡는다.
  id(value: string): StringId {
    const known = this.ids.get(value);
    if (known !== undefined) return known;
    const owned = Buffer.from(value, 'utf8').toString('utf8');
    const id = this.texts.length;
    this.texts.push(owned);
    this.ids.set(owned, id);
    return id;
  }

  find(value: string): StringId | undefined {
    return this.ids.get(value);
  }

  text(id: StringId): string {
    return this.texts[id];
  }

  get size(): number {
    return this.texts.length;
  }
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx mocha test/unit/infra/string-pool.test.ts`
Expected: PASS (5 passing)

- [ ] **Step 5: 보유량 테스트를 더한다 — 이 파일의 존재 이유를 지키는 테스트다**

```ts
// test/unit/infra/string-pool.test.ts 에 이어서
const gc = () => { for (let i = 0; i < 4; i++) (global as { gc?: () => void }).gc?.(); };

describe('StringPool 보유량', () => {
  it('조각을 풀에 넣어도 원본 문자열이 남지 않는다', function () {
    if (typeof (global as { gc?: () => void }).gc !== 'function') this.skip();
    const pool = new StringPool();
    gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 5; i++) {
      const big = `${'x'.repeat(4 * 1024 * 1024)}\nget_string('key_${i}', 'local_component')\n`;
      const m = /get_string\('([\w]+)',\s*'([\w]+)'\)/.exec(big)!;
      pool.id(m[1]);
      pool.id(m[2]);
    }
    gc();
    const retained = process.memoryUsage().heapUsed - before;
    assert.ok(retained < 4 * 1024 * 1024,
      `원본 텍스트가 붙잡혀 있다 — 보유 ${(retained / 1048576).toFixed(1)} MB (조각 10개만 남아야 한다)`);
  });
});
```

- [ ] **Step 6: 보유량 테스트가 판별하는지 확인한다**

`--expose-gc` 없이 돌면 건너뛴다. 실제로 검사하려면 gc를 켜서 돌린다.

Run: `node --expose-gc ./node_modules/.bin/_mocha test/unit/infra/string-pool.test.ts`
Expected: PASS (6 passing)

그 다음 `id()`의 `Buffer.from(...).toString(...)` 한 줄을 `const owned = value;`로 바꾸고 같은 명령을 다시 돌린다.
Expected: FAIL — 보유량이 20 MB 안팎으로 올라 단정이 깨진다. 실패 메시지의 실제 수치를 보고한다. 확인 후 되돌린다.

- [ ] **Step 7: 커밋**

```bash
git add src/infrastructure/usage/string-pool.ts test/unit/infra/string-pool.test.ts
git commit -m "feat: 문자열 풀 — 넣을 때 사본을 만들어 원본 보유를 끊는다"
```

---

### Task 2: id 기반 항목 타입

**Files:**
- Create: `src/infrastructure/usage/usage-entries.ts`
- Test: `test/unit/infra/usage-entries.test.ts`

**Interfaces:**
- Consumes: `StringId` (Task 1)
- Produces:
  - `interface StringUsage { component: StringId; key: StringId; file: StringId; line: number; column: number }`
  - `interface RefUsage { ref: StringId; file: StringId; line: number; column: number }`
  - `interface ConfigUsage { id: StringId; file: StringId; line: number; column: number }`
  - `interface TableUsage { name: StringId; file: StringId; line: number; column: number }`
  - `interface UsageExtract { strings: StringUsage[]; templates: RefUsage[]; amd: RefUsage[]; config: ConfigUsage[]; tables: TableUsage[] }`
  - `function emptyExtract(): UsageExtract`

이 파일이 강제 지점이다. 항목의 모든 문자열 자리가 `StringId`이므로, 풀을 지나지 않은 값은 타입 검사에서 걸린다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// test/unit/infra/usage-entries.test.ts
import { strict as assert } from 'assert';
import { emptyExtract } from '../../../src/infrastructure/usage/usage-entries';

describe('emptyExtract', () => {
  it('다섯 종류가 모두 빈 배열이다', () => {
    const e = emptyExtract();
    assert.deepEqual(
      Object.entries(e).map(([k, v]) => [k, (v as unknown[]).length]),
      [['strings', 0], ['templates', 0], ['amd', 0], ['config', 0], ['tables', 0]]);
  });

  it('호출마다 새 배열을 준다', () => {
    const a = emptyExtract();
    a.strings.push({ component: 0, key: 1, file: 2, line: 0, column: 0 });
    assert.equal(emptyExtract().strings.length, 0);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx mocha test/unit/infra/usage-entries.test.ts`
Expected: FAIL — `Cannot find module '.../usage-entries'`

- [ ] **Step 3: 구현한다**

```ts
// src/infrastructure/usage/usage-entries.ts
import { StringId } from './string-pool';

// 문자열 자리가 전부 StringId다 — 풀을 지나지 않은 값은 여기에 담길 수 없다.
export interface StringUsage { component: StringId; key: StringId; file: StringId; line: number; column: number }
export interface RefUsage { ref: StringId; file: StringId; line: number; column: number }
export interface ConfigUsage { id: StringId; file: StringId; line: number; column: number }
export interface TableUsage { name: StringId; file: StringId; line: number; column: number }

export interface UsageExtract {
  strings: StringUsage[];
  templates: RefUsage[];
  amd: RefUsage[];
  config: ConfigUsage[];
  tables: TableUsage[];
}

export function emptyExtract(): UsageExtract {
  return { strings: [], templates: [], amd: [], config: [], tables: [] };
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx mocha test/unit/infra/usage-entries.test.ts`
Expected: PASS (2 passing)

- [ ] **Step 5: 커밋**

```bash
git add src/infrastructure/usage/usage-entries.ts test/unit/infra/usage-entries.test.ts
git commit -m "feat: id 기반 사용처 항목 타입"
```

---

### Task 3: 추출기 분리

**Files:**
- Create: `src/infrastructure/usage/extract-usages.ts`
- Test: `test/unit/infra/extract-usages.test.ts`
- Modify: `src/infrastructure/usage/php-usage-index.ts` — 추출 관련 정규식·헬퍼를 위 파일로 옮긴다

**Interfaces:**
- Consumes: `StringPool`·`StringId` (Task 1), `UsageExtract`·`emptyExtract` (Task 2)
- Produces:
  - `interface ExtractContext { pool: StringPool; file: StringId; hasCanonical: (component: string) => boolean }`
  - `function extractUsages(uri: string, text: string, ctx: ExtractContext): UsageExtract` — 확장자로 PHP·JS·mustache를 고른다
  - `function isIndexableSourcePath(root: string, fsPath: string): boolean` — 기존 함수를 그대로 옮긴다(현재 `php-usage-index.ts`가 export 하고 `src/extension.ts`가 쓴다)

**옮기는 것**: `USAGE_RE`·`TEMPLATE_USAGE_RE`·`AMD_USAGE_RE`·`CONFIG_GET_RE`·`CONFIG_SET_RE`·`TABLE_BRACE_RE`·`TABLE_DML_RE`·`SKIP_DIRS`·`forEachMatch`·`isIndexableSourcePath`와 세 추출 메서드. 정규식은 모듈 스코프에 그대로 둔다.

**바뀌는 것**: 캡처한 문자열을 그대로 담지 않고 `ctx.pool.id(...)`를 지나게 한다. 컴포넌트 정규화(`normalizeComponent`)는 문자열 단계에서 먼저 하고 그 결과를 풀에 넣는다 — 정규화된 값이 저장 대상이다.

**바뀌지 않는 것**: 어떤 형태를 잡고 무엇을 거르는지는 그대로다. `sql_` 접두 메서드 제외, 컴포넌트가 리터럴이 아니면 비매칭, 줄·컬럼 계산 방식 전부 현행과 같아야 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// test/unit/infra/extract-usages.test.ts
import { strict as assert } from 'assert';
import { StringPool } from '../../../src/infrastructure/usage/string-pool';
import { extractUsages } from '../../../src/infrastructure/usage/extract-usages';

function extract(uri: string, text: string) {
  const pool = new StringPool();
  const file = pool.id(uri);
  const out = extractUsages(uri, text, { pool, file, hasCanonical: () => true });
  return { pool, out };
}

describe('extractUsages — PHP', () => {
  const SRC = `<?php
echo get_string('greet', 'local_x');
$OUTPUT->render_from_template('local_x/card', $c);
$PAGE->requires->js_call_amd('local_x/view', 'init');
echo get_config('local_x', 'apikey');
$sql = "SELECT * FROM {local_table}";
$DB->update_record('local_other', $r);
$DB->sql_like('col', '?');
`;

  it('문자열 호출을 id로 담는다', () => {
    const { pool, out } = extract('/a/b.php', SRC);
    const e = out.strings[0];
    assert.equal(pool.text(e.key), 'greet');
    assert.equal(pool.text(e.component), 'local_x');
    assert.equal(pool.text(e.file), '/a/b.php');
  });

  it('템플릿·AMD·설정을 담는다', () => {
    const { pool, out } = extract('/a/b.php', SRC);
    assert.equal(pool.text(out.templates[0].ref), 'local_x/card');
    assert.equal(pool.text(out.amd[0].ref), 'local_x/view');
    assert.equal(pool.text(out.config[0].id), 'local_x/apikey');
  });

  it('SQL 중괄호와 $DB 첫 인자를 담고 sql_ 계열은 거른다', () => {
    const { pool, out } = extract('/a/b.php', SRC);
    const names = out.tables.map(t => pool.text(t.name)).sort();
    assert.deepEqual(names, ['local_other', 'local_table']);
  });

  it('같은 값은 하나의 id를 공유한다', () => {
    const { pool, out } = extract('/a/b.php', `<?php
echo get_string('k', 'local_x');
echo get_string('k', 'local_x');
`);
    assert.equal(out.strings[0].key, out.strings[1].key);
    assert.equal(out.strings[0].component, out.strings[1].component);
  });
});

describe('extractUsages — 확장자별', () => {
  it('mustache의 partial과 {{#str}}를 담는다', () => {
    const { pool, out } = extract('/a/t.mustache', `{{> local_x/inner}}\n{{#str}}greet, local_x{{/str}}\n`);
    assert.equal(pool.text(out.templates[0].ref), 'local_x/inner');
    assert.equal(pool.text(out.strings[0].key), 'greet');
  });

  it('JS의 get_string과 Templates.render를 담는다', () => {
    const { pool, out } = extract('/a/m.js', `get_string('greet', 'local_x');\nTemplates.render('local_x/card', {});\n`);
    assert.equal(pool.text(out.strings[0].key), 'greet');
    assert.equal(pool.text(out.templates[0].ref), 'local_x/card');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx mocha test/unit/infra/extract-usages.test.ts`
Expected: FAIL — `Cannot find module '.../extract-usages'`

- [ ] **Step 3: 옮기고 고친다**

`php-usage-index.ts`에서 위에 적은 상수·헬퍼·세 추출 메서드를 잘라내 `extract-usages.ts`로 옮긴다. 메서드였던 것은 `ctx`를 받는 함수로 바꾸고, 각 `push` 자리에서 문자열 대신 `ctx.pool.id(...)`를 담는다. 예를 들어 PHP의 문자열 호출은 이렇게 된다.

```ts
forEachMatch(text, USAGE_RE, (m, line, lineStart) => {
  const form = m[1] ? stringFunctionForm(m[1]) : stringClassForm(m[2]);
  if (!form) return;
  const component = normalizeComponent(effectiveComponent(form, m[4] ?? ''), ctx.hasCanonical);
  out.strings.push({
    component: ctx.pool.id(component),
    key: ctx.pool.id(m[3]),
    file: ctx.file,
    line,
    column: firstLiteralColumn(m, lineStart),
  });
});
```

`extractUsages`는 확장자로 갈라 기존 `updateFileText`가 하던 판단을 그대로 한다.

```ts
export function extractUsages(uri: string, text: string, ctx: ExtractContext): UsageExtract {
  if (uri.endsWith('.js')) return extractJs(text, ctx);
  if (uri.endsWith('.mustache')) return extractMustache(text, ctx);
  return extractPhp(text, ctx);
}
```

`php-usage-index.ts`는 `isIndexableSourcePath`를 계속 export 해야 한다 — `src/extension.ts`가 그 경로로 import 하고 있다. 새 파일에서 정의하고 `php-usage-index.ts`에서 `export { isIndexableSourcePath } from './extract-usages';`로 다시 내보낸다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx mocha test/unit/infra/extract-usages.test.ts`
Expected: PASS (6 passing)

- [ ] **Step 5: 커밋**

```bash
git add src/infrastructure/usage/extract-usages.ts src/infrastructure/usage/php-usage-index.ts \
  test/unit/infra/extract-usages.test.ts
git commit -m "refactor: 사용처 추출을 분리하고 풀을 지나게 한다"
```

---

### Task 4: 저장 구조를 id로

**Files:**
- Modify: `src/infrastructure/usage/php-usage-index.ts`

**Interfaces:**
- Consumes: `StringPool`·`StringId` (Task 1), `UsageExtract` 계열 (Task 2), `extractUsages` (Task 3)
- Produces: 공개 표면은 그대로. 내부 필드가 id 기반이 된다.

**보관 구조**

```ts
private pool = new StringPool();
private byFile = new Map<StringId, UsageExtract>();
private byComponentKey = new Map<StringId, Map<StringId, StringUsage[]>>();
private byTemplateRef = new Map<StringId, RefUsage[]>();
private byAmdRef = new Map<StringId, RefUsage[]>();
private byConfigId = new Map<StringId, ConfigUsage[]>();
private byTableName = new Map<StringId, TableUsage[]>();
private stamps = new Map<StringId, FileStamp>();
```

**조회 경계에서 되살린다** — 한 번 조회가 돌려주는 위치는 많아야 수백 건이라 비용이 없다.

```ts
private location(e: { file: StringId; line: number; column: number }): SourceLocation {
  return { uri: this.pool.text(e.file), line: e.line, column: e.column };
}
```

**조회는 풀을 늘리지 않는다** — `referencesOf('없는컴포넌트', 'k')` 같은 호출이 `id()`를 부르면 풀이 조회할 때마다 자란다. 반드시 `find()`를 쓰고, `undefined`면 빈 배열을 돌려준다.

```ts
referencesOf(component: string, key: string): SourceLocation[] {
  const c = this.pool.find(component);
  const k = c === undefined ? undefined : this.pool.find(key);
  if (c === undefined || k === undefined) return [];
  return (this.byComponentKey.get(c)?.get(k) ?? []).map(e => this.location(e));
}
```

**스냅샷은 경계에서 변환한다** — 포맷(`SNAPSHOT_VERSION = 2`)은 그대로 두어 사용자의 기존 캐시가 무효화되지 않게 한다. `toSnapshot`은 id를 `pool.text(...)`로 풀어 쓰고, `loadSnapshot`은 읽은 문자열을 `pool.id(...)`로 넣는다.

**파일 단위 교체**에서 게시 목록을 손볼 때, 현재 코드는 `arr.indexOf(e.loc)`로 위치 객체의 동일성을 찾는다. 항목이 수치가 되면 그 방법이 통하지 않는다. 대신 그 파일의 id로 거른다.

```ts
private removeFileEntries(file: StringId): void {
  const prev = this.byFile.get(file);
  if (!prev) return;
  for (const e of prev.strings) {
    const keys = this.byComponentKey.get(e.component);
    const arr = keys?.get(e.key);
    if (arr) keys!.set(e.key, arr.filter(x => x.file !== file));
  }
  // templates·amd·config·tables도 같은 모양으로 각자의 맵에서 거른다
  this.byFile.delete(file);
}
```

- [ ] **Step 1: 기존 테스트를 먼저 돌려 기준을 잡는다**

`.mocharc.json`의 `spec`이 고정이라 파일 하나만 돌릴 수 없다. 전체 스위트로 기준을 잡는다.

Run: `npm run test:unit`
Expected: PASS. 통과 수를 기록한다 — 이 태스크가 끝났을 때 그 수보다 줄면 회귀다.

빌드 시간 기준선도 함께 잡는다. 이 시점의 색인은 파일마다 임시 풀을 만들고 id를 문자열로 되돌리는
과도기 상태라 빌드가 느리다(실측 13.6 s, 원래 6.3 s). 이 태스크가 그것을 되돌려야 한다.

- [ ] **Step 2: 새 동작을 고정하는 테스트를 더한다**

```ts
// test/unit/infra/php-usage-index.test.ts 에 이어서
describe('PhpUsageIndex — 풀 규율', () => {
  it('없는 값으로 조회해도 풀이 자라지 않는다', () => {
    const idx = new PhpUsageIndex(() => true);
    idx.updateFileText('/a/b.php', `<?php echo get_string('k', 'local_x');`);
    const before = (idx as unknown as { pool: { size: number } }).pool.size;
    idx.referencesOf('없는컴포넌트', '없는키');
    idx.templateRefsOf('없는컴포넌트', '없는이름');
    idx.amdRefsOf('없는컴포넌트', '없는이름');
    idx.configRefsOf('없는플러그인', '없는키');
    idx.tableRefsOf('없는테이블');
    assert.equal((idx as unknown as { pool: { size: number } }).pool.size, before);
  });

  it('파일을 다시 읽으면 옛 항목이 게시 목록에서 빠진다', () => {
    const idx = new PhpUsageIndex(() => true);
    idx.updateFileText('/a/b.php', `<?php echo get_string('old', 'local_x');`);
    idx.updateFileText('/a/b.php', `<?php echo get_string('new', 'local_x');`);
    assert.equal(idx.referencesOf('local_x', 'old').length, 0);
    assert.equal(idx.referencesOf('local_x', 'new').length, 1);
  });

  it('두 파일이 같은 키를 쓰면 한 파일만 지워도 다른 파일은 남는다', () => {
    const idx = new PhpUsageIndex(() => true);
    idx.updateFileText('/a/one.php', `<?php echo get_string('k', 'local_x');`);
    idx.updateFileText('/a/two.php', `<?php echo get_string('k', 'local_x');`);
    idx.updateFileText('/a/one.php', '');
    const found = idx.referencesOf('local_x', 'k');
    assert.equal(found.length, 1);
    assert.equal(found[0].uri, '/a/two.php');
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

Run: `npx mocha test/unit/infra/php-usage-index.test.ts`
Expected: FAIL — 첫 케이스가 `pool` 필드가 없어 실패한다(나머지 두 개는 현행 구현에서도 통과할 수 있다)

- [ ] **Step 4: 저장 구조를 id 기반으로 바꾼다**

위 설계대로 필드·조회·교체를 고친다. `updateFileText`는 `pool.id(uri)`로 파일 id를 얻어 `extractUsages`에 넘긴다.

스냅샷은 경계에서만 변환한다. `toSnapshot`의 행 만드는 자리에서 id를 풀어 쓴다.

```ts
s: packRows(rows(this.byFile, e => e.strings),
  e => [this.pool.text(e.component), this.pool.text(e.key), e.line, e.column]),
t: packRows(rows(this.byFile, e => e.templates),
  e => [this.pool.text(e.ref), e.line, e.column]),
```

`loadSnapshot`은 읽은 문자열을 풀에 넣는다. JSON에서 온 문자열은 조각이 아니지만, 풀을 지나야 같은 값이
하나의 id를 공유한다.

```ts
unpackRows(snap.s, 4, (i, r) => {
  if (!known(i)) return;
  slot(i).strings.push({
    component: this.pool.id(r[0] as string),
    key: this.pool.id(r[1] as string),
    file: fileIds[i],
    line: r[2] as number,
    column: r[3] as number,
  });
});
```

- [ ] **Step 5: 전체 테스트를 돌린다**

```bash
npx mocha test/unit/infra/php-usage-index.test.ts
npx mocha test/unit/infra/usage-snapshot.test.ts
npx mocha test/unit/infra/usage-index-cache.test.ts
npx tsc -noEmit && npm run test:unit && npm run lint
```
Expected: 48 + 3(새로) passing, 17 passing, 8 passing, 그리고 전체 스위트 통과

- [ ] **Step 6: 커밋**

```bash
git add src/infrastructure/usage/php-usage-index.ts test/unit/infra/php-usage-index.test.ts
git commit -m "refactor: 사용처 색인이 문자열 대신 id를 보관한다"
```

---

### Task 5: 메모리 회귀 게이트

**Files:**
- Create: `test/unit/infra/usage-index-memory.test.ts`

**Interfaces:**
- Consumes: `PhpUsageIndex` (Task 4)

이 테스트가 이 계획의 성과를 지킨다. 코퍼스와 `--expose-gc`가 둘 다 있을 때만 돌고, 없으면 건너뛴다.

- [ ] **Step 1: 테스트를 쓴다**

```ts
// test/unit/infra/usage-index-memory.test.ts
import { strict as assert } from 'assert';
import * as fs from 'fs';
import { PhpUsageIndex } from '../../../src/infrastructure/usage/php-usage-index';

const CEILING_MB = 30;
const gc = () => { for (let i = 0; i < 4; i++) (global as { gc?: () => void }).gc?.(); };

describe('PhpUsageIndex 보유 메모리', () => {
  it('코퍼스 전체를 색인해도 상한 안에 머문다', async function () {
    const root = process.env.CSMS_CORPUS;
    if (!root || !fs.existsSync(root)) this.skip();
    if (typeof (global as { gc?: () => void }).gc !== 'function') this.skip();
    this.timeout(180000);

    gc();
    const before = process.memoryUsage().heapUsed;
    const idx = new PhpUsageIndex(() => true);
    await idx.buildFromRoot(root);
    gc();
    const retainedMb = (process.memoryUsage().heapUsed - before) / 1048576;

    assert.ok(idx.isBuilt);
    assert.ok(retainedMb < CEILING_MB,
      `보유 ${retainedMb.toFixed(1)} MB — 상한 ${CEILING_MB} MB를 넘었다. 캡처가 풀을 지나지 않는 자리가 생겼을 수 있다`);
  });
});
```

- [ ] **Step 2: 코퍼스 없이 돌려 건너뛰는지 확인한다**

Run: `npx mocha test/unit/infra/usage-index-memory.test.ts`
Expected: 0 passing, 1 pending

- [ ] **Step 3: 코퍼스와 gc를 켜고 돌린다**

Run: `CSMS_CORPUS=~/workspace/csms45 node --expose-gc ./node_modules/.bin/_mocha test/unit/infra/usage-index-memory.test.ts`
Expected: PASS. 실제 보유량을 보고한다 — 기준선은 131 MB, 목표는 23 MB 안팎이다.

- [ ] **Step 4: 게이트가 판별하는지 확인한다**

`src/infrastructure/usage/string-pool.ts`의 `id()`에서 사본 만드는 줄을 `const owned = value;`로 바꾸고 Step 3을 다시 돌린다.
Expected: FAIL — 보유량이 상한을 크게 넘는다. 실제 수치를 보고하고 되돌린다.

- [ ] **Step 5: 커밋**

```bash
git add test/unit/infra/usage-index-memory.test.ts
git commit -m "test: 사용처 색인 보유 메모리 상한 게이트"
```

---

### Task 6: 측정과 릴리스

**Files:**
- Modify: `package.json`, `CHANGELOG.md`, `README.md`

**Interfaces:**
- Consumes: Task 4의 구현, Task 5의 게이트

- [ ] **Step 1: 기준선과 같은 방법으로 잰다**

```bash
CSMS_CORPUS=~/workspace/csms45 node --expose-gc ./node_modules/.bin/_mocha test/unit/infra/usage-index-memory.test.ts
```

보유량과 빌드 시간을 한 번에 잰다. 기준선(131 MB / 6.3 s)과 같은 방법이다.

```bash
CSMS_CORPUS=~/workspace/csms45 TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","target":"ES2021","esModuleInterop":true,"skipLibCheck":true,"strict":false}' \
node --expose-gc -r ts-node/register/transpile-only -e "
const { PhpUsageIndex } = require('./src/infrastructure/usage/php-usage-index');
const gc = () => { for (let i = 0; i < 4; i++) global.gc(); };
(async () => {
  gc();
  const before = process.memoryUsage().heapUsed;
  const t0 = Date.now();
  const idx = new PhpUsageIndex(() => true);
  await idx.buildFromRoot(process.env.CSMS_CORPUS);
  const secs = (Date.now() - t0) / 1000;
  gc();
  const mb = (process.memoryUsage().heapUsed - before) / 1048576;
  console.log('보유 ' + mb.toFixed(1) + ' MB, 빌드 ' + secs.toFixed(1) + 's (기준선 131 MB / 6.3 s)');
})();
"
```

추측한 수치를 적지 않는다 — 이 명령이 찍은 값을 쓴다.

- [ ] **Step 2: 캐시 왕복이 여전히 맞는지 확인한다**

스냅샷은 경계에서 문자열로 변환되므로 포맷이 그대로여야 한다. 저장했다가 새 색인으로 복원해 조회 결과가 같은지 확인한다.

```bash
CSMS_CORPUS=~/workspace/csms45 npx ts-node -O '{"module":"commonjs","target":"ES2021","esModuleInterop":true,"skipLibCheck":true,"strict":false}' -e "
import { PhpUsageIndex } from './src/infrastructure/usage/php-usage-index';
(async () => {
  const root = process.env.CSMS_CORPUS!;
  const a = new PhpUsageIndex(() => true);
  await a.buildFromRoot(root);
  const snap = a.toSnapshot(root, '0.23.0');
  const b = new PhpUsageIndex(() => true);
  b.loadSnapshot(JSON.parse(JSON.stringify(snap)), root);
  const names = (a as any).byTableName ? [...(a as any).byTableName.keys()] : [];
  let mismatch = 0, checked = 0;
  for (const id of names.slice(0, 2000)) {
    const name = (a as any).pool.text(id);
    const x = JSON.stringify(a.tableRefsOf(name)), y = JSON.stringify(b.tableRefsOf(name));
    checked++; if (x !== y) mismatch++;
  }
  console.log('왕복 대조', checked, '건 중 불일치', mismatch);
})();
"
```
Expected: `불일치 0`. 0이 아니면 멈추고 보고한다.

- [ ] **Step 3: 버전과 변경 이력**

`package.json`의 `version`을 `0.23.0`으로 올리고 `CHANGELOG.md` 맨 위에 기존 항목과 같은 모양으로 더한다. 실제 측정치를 적는다 — 흔들리는 수치는 이 파일의 관례대로 범위로 적는다.

```markdown
## [0.23.0] — <오늘 날짜>

### 변경
- **사용처 색인이 붙잡고 있던 파일 텍스트를 없앴습니다.** 정규식으로 뽑은 조각은 원본 문자열을 가리키기만 해서, 조각을 보관하면 그 파일 전체가 메모리에 남아 있었습니다. 문자열 풀을 두어 넣을 때 사본을 만들고, 색인이 문자열 대신 id를 보관하게 했습니다. 실측(csms45 24,890개 파일): **창당 보유 131MB → <측정치>MB**. 스캔 시간과 조회 결과는 그대로입니다.
```

- [ ] **Step 4: README에 메모리 게이트를 켜는 방법을 적는다**

이미 `CSMS_CORPUS`·`CSMS_BUDGET_FILE`을 적은 자리 옆에, 메모리 게이트는 `--expose-gc`도 필요하다는 것을 한 줄로 더한다.

- [ ] **Step 5: 전체 검증 후 커밋**

```bash
npx tsc -noEmit && npm run test:unit && npm run lint && npm run bundle
git add -A
git commit -m "chore: 0.23.0 — 사용처 색인 메모리"
```

---

## 다음 단계

스펙 §6(3단계 순회·워처·스냅샷)은 이 계획이 착지한 뒤 별도 계획을 받는다. 항목을 수치 배열로 바꾸는 컬럼형 저장은 추가 이득이 약 7 MB로 추정되어 이번 범위에 넣지 않았다 — 필요해지면 그때 실측으로 판단한다.
