# JS/AMD 인텔리전스 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** JS/AMD 파일에서 `get_string`·`Templates.render` 리터럴에 정의 이동·hover·하이라이트를 제공하고, lang·.mustache의 참조 목록에 JS 호출처를 포함시킨다.

**Architecture:** JS는 tree-sitter 문법이 없으므로 순수 정규식 스캐너(`scanJsCalls`)로 처리한다. 색인은 새로 만들지 않고 기존 `StringIndexStore`·`TemplateIndex`를 그대로 조회하며, 사용처 색인(`PhpUsageIndex`)의 파일 열거를 `.js`까지 넓히되 **`amd/build`·`.min.js`는 제외**(미니파이 사본이라 참조가 중복된다). 콜드 스캔과 저장 증분은 **같은 술어**를 공유한다.

**Tech Stack:** TypeScript (strict), 정규식(JS 스캔), mocha + ts-node.

**Spec:** `docs/superpowers/specs/2026-08-05-js-amd-intelligence-design.md`

## Global Constraints

- **JS는 AST 없음** — 진단은 비목표(주석 속 호출 오탐 방지). 이동/hover/참조/하이라이트만.
- **`amd/build`·`.min.js` 제외**는 콜드 스캔·저장 증분 **양쪽에서 같은 함수**(`isIndexableSourcePath`)로 강제한다 — 지난 사이클의 패리티 부재 결함 재발 방지.
- 라인 계산은 증분 카운트(O(n²) 금지). 위치는 리터럴 **내용** 시작(여는 따옴표 다음).
- 새 색인·새 스캔 금지 — 기존 색인 조회와 기존 사용처 스캔 확장만.
- 유닛: `npm run test:unit`. 커밋: `feat|fix|docs(scope): 한국어 요약`.

---

### Task 1: JS 호출 스캐너

**Files:**
- Create: `src/domain/code-analysis/js-call-scanner.ts`
- Test: `test/unit/domain/js-call-scanner.test.ts`

**Interfaces:**
- Consumes: 없음(순수 함수).
- Produces:
```ts
export interface JsStringCall { key: string; component: string; keyLine: number; keyColumn: number; keyIndex: number; }
export interface JsTemplateCall { ref: string; refLine: number; refColumn: number; refIndex: number; }
export interface JsCalls { stringCalls: JsStringCall[]; templateCalls: JsTemplateCall[]; }
export function scanJsCalls(text: string): JsCalls;
```
Task 2·3이 소비.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/unit/domain/js-call-scanner.test.ts` 신규:
```ts
import { strict as assert } from 'assert';
import { scanJsCalls } from '../../../src/domain/code-analysis/js-call-scanner';

const CODE = `define(['core/str', 'core/templates'], function(str, Templates) {
    var a = M.util.get_string('confirm_delete', 'local_ubnotification');
    var b = str.get_string("attendance_book", "local_ubattend");
    var c = getString('ok', 'core');
    Templates.render('local_ubattend/setting', {});
    const { html } = await renderForPromise("local_talk/common/toast", {});
    render('no_slash_here', {});
    somethingElse('local_x/y', {});
});
`;

describe('scanJsCalls', () => {
  const r = scanJsCalls(CODE);

  it('M.util.get_string / <모듈>.get_string / getString 3형태 모두 추출', () => {
    const keys = r.stringCalls.map(c => c.key).sort();
    assert.deepEqual(keys, ['attendance_book', 'confirm_delete', 'ok']);
  });
  it('겹따옴표도 인식하고 component를 정확히 짝지음', () => {
    const c = r.stringCalls.find(x => x.key === 'attendance_book')!;
    assert.equal(c.component, 'local_ubattend');
  });
  it('문자열 키 위치가 리터럴 내용 시작을 가리킴', () => {
    const c = r.stringCalls.find(x => x.key === 'confirm_delete')!;
    assert.equal(CODE.slice(c.keyIndex, c.keyIndex + c.key.length), 'confirm_delete');
    assert.equal(c.keyLine, 1);
  });
  it('Templates.render·구조분해 renderForPromise 모두 추출', () => {
    const refs = r.templateCalls.map(c => c.ref).sort();
    assert.deepEqual(refs, ['local_talk/common/toast', 'local_ubattend/setting']);
  });
  it("'/' 없는 ref와 render 아닌 함수는 비추출", () => {
    assert.ok(!r.templateCalls.some(c => c.ref === 'no_slash_here'));
    assert.ok(!r.templateCalls.some(c => c.ref === 'local_x/y'));
  });
  it('템플릿 ref 위치가 리터럴 내용 시작을 가리킴', () => {
    const c = r.templateCalls.find(x => x.ref === 'local_ubattend/setting')!;
    assert.equal(CODE.slice(c.refIndex, c.refIndex + c.ref.length), 'local_ubattend/setting');
    assert.equal(c.refLine, 4);
  });
  it('빈 텍스트·호출 없음 → 빈 배열', () => {
    const e = scanJsCalls('const x = 1;\n');
    assert.deepEqual(e.stringCalls, []);
    assert.deepEqual(e.templateCalls, []);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx mocha test/unit/domain/js-call-scanner.test.ts`
Expected: FAIL — 모듈 미존재.

- [ ] **Step 3: 구현**

`src/domain/code-analysis/js-call-scanner.ts` 신규:
```ts
export interface JsStringCall { key: string; component: string; keyLine: number; keyColumn: number; keyIndex: number; }
export interface JsTemplateCall { ref: string; refLine: number; refColumn: number; refIndex: number; }
export interface JsCalls { stringCalls: JsStringCall[]; templateCalls: JsTemplateCall[]; }

// M.util.get_string / <모듈>.get_string / getString — \b가 '.' 뒤에서도 성립하므로 수신자 무관
const JS_STRING_RE = /\b(?:get_string|getString)\s*\(\s*(['"])([\w:.\-/]+)\1\s*,\s*(['"])(\w+)\3/g;
// Templates.render / renderForPromise / 구조분해된 render — ref에 '/'를 요구해 일반 render() 오탐을 거른다
const JS_TEMPLATE_RE = /\brender(?:ForPromise)?\s*\(\s*(['"])([\w.\-]+\/[\w.\-/]+)\1/g;

/** JS/AMD 소스에서 리터럴 get_string·템플릿 render 호출을 추출한다.
 *  AST가 아니라 정규식이므로 주석·문자열 안의 호출도 잡힌다 — 진단이 아닌 이동/hover/참조 용도라 침묵 방향으로 안전하다. */
export function scanJsCalls(text: string): JsCalls {
  return {
    stringCalls: scan(text, JS_STRING_RE, (m, line, column, index) => ({
      key: m[2], component: m[4], keyLine: line, keyColumn: column, keyIndex: index,
    })),
    templateCalls: scan(text, JS_TEMPLATE_RE, (m, line, column, index) => ({
      ref: m[2], refLine: line, refColumn: column, refIndex: index,
    })),
  };
}

/** 공통 순회 — 증분 라인 계산(O(n²) 금지) + 첫 따옴표 다음이 리터럴 내용 시작 */
function scan<T>(text: string, re: RegExp, make: (m: RegExpExecArray, line: number, column: number, index: number) => T): T[] {
  const out: T[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  let lastIdx = 0, lastLine = 0;
  while ((m = re.exec(text))) {
    for (let i = lastIdx; i < m.index; i++) if (text.charCodeAt(i) === 10) lastLine++;
    lastIdx = m.index;
    const quoteOffset = m[0].search(/['"]/);
    const contentIndex = m.index + quoteOffset + 1;
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    out.push(make(m, lastLine, contentIndex - lineStart, contentIndex));
  }
  return out;
}
```

- [ ] **Step 4: 테스트 통과 + 회귀 확인**

Run: `npx mocha test/unit/domain/js-call-scanner.test.ts && npm run test:unit && npx tsc -noEmit`
Expected: 신규 7건 녹색 — 165건(158+7).

- [ ] **Step 5: Commit**

```bash
git add src/domain/code-analysis/js-call-scanner.ts test/unit/domain/js-call-scanner.test.ts
git commit -m "feat(infra): JS 호출 스캐너 — get_string·Templates.render 리터럴 추출"
```

---

### Task 2: 사용처 색인을 JS까지 확장 (amd/build 제외)

**Files:**
- Modify: `src/infrastructure/usage/php-usage-index.ts`
- Modify: `src/extension.ts` (`isIndexablePhpPath` → `isIndexableSourcePath`, 저장 핸들러 조건)
- Create: 픽스처 `test/fixtures/mini-moodle/local/ubattend/amd/src/view.js`, `test/fixtures/mini-moodle/local/ubattend/amd/build/view.min.js`
- Test: `test/unit/infra/php-usage-index.test.ts`

**Interfaces:**
- Consumes: Task 1 `scanJsCalls`.
- Produces: `isIndexableSourcePath(root, fsPath): boolean`(`isIndexablePhpPath` 대체 — `.php`·`.js` 허용, `amd/build`·`.min.js`·SKIP_DIRS·루트 밖 제외). `PhpUsageIndex` 공개 API는 그대로.

- [ ] **Step 1: 픽스처 2개 생성**

`test/fixtures/mini-moodle/local/ubattend/amd/src/view.js`:
```js
define(['core/str', 'core/templates'], function(str, Templates) {
    str.get_string('attendance_book', 'local_ubattend');
    Templates.render('local_ubattend/setting', {});
});
```

`test/fixtures/mini-moodle/local/ubattend/amd/build/view.min.js` (같은 호출의 미니파이 사본 — 색인되면 안 된다):
```js
define(["core/str","core/templates"],function(s,T){s.get_string("attendance_book","local_ubattend");T.render("local_ubattend/setting",{})});
```

- [ ] **Step 2: 실패하는 테스트 작성**

`test/unit/infra/php-usage-index.test.ts` — import에 `isIndexableSourcePath` 추가(기존 `isIndexablePhpPath` import는 제거), 기존 `isIndexablePhpPath` 테스트의 함수명을 `isIndexableSourcePath`로 바꾸고 다음 단언 3줄을 그 테스트 본문 끝에 추가:
```ts
    assert.equal(isIndexableSourcePath(root, join(root, 'local/ubattend/amd/src/view.js')), true);
    assert.equal(isIndexableSourcePath(root, join(root, 'local/ubattend/amd/build/view.min.js')), false);
    assert.equal(isIndexableSourcePath(root, join(root, 'local/ubattend/amd/build/view.js')), false);
```

파일 끝에 describe 추가:
```ts
describe('PhpUsageIndex — JS 사용처(같은 스캔에서 수집)', () => {
  const jidx = new PhpUsageIndex(() => false);
  before(async () => { await jidx.buildFromRoot(root); });

  it('JS의 get_string 호출이 참조로 잡힘', () => {
    const refs = jidx.referencesOf('local_ubattend', 'attendance_book');
    assert.ok(refs.some(r => r.uri.endsWith(join('amd', 'src', 'view.js'))), 'amd/src의 JS 호출이 포함돼야 함');
  });
  it('JS의 Templates.render 호출이 템플릿 참조로 잡힘', () => {
    const refs = jidx.templateRefsOf('local_ubattend', 'setting');
    assert.ok(refs.some(r => r.uri.endsWith(join('amd', 'src', 'view.js'))));
  });
  it('amd/build 사본은 색인되지 않음(중복 0)', () => {
    const all = [...jidx.referencesOf('local_ubattend', 'attendance_book'),
                 ...jidx.templateRefsOf('local_ubattend', 'setting')];
    assert.equal(all.filter(r => r.uri.includes(join('amd', 'build'))).length, 0);
  });
  it('JS 파일 증분 교체', () => {
    const uri = join(root, 'local/ubattend/amd/src/view.js');
    jidx.updateFileText(uri, "str.get_string('other_key', 'local_ubattend');\n");
    assert.equal(jidx.referencesOf('local_ubattend', 'other_key').length, 1);
    assert.ok(!jidx.referencesOf('local_ubattend', 'attendance_book').some(r => r.uri.endsWith('view.js')));
    assert.equal(jidx.templateRefsOf('local_ubattend', 'setting').filter(r => r.uri.endsWith('view.js')).length, 0);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx mocha test/unit/infra/php-usage-index.test.ts`
Expected: FAIL — `isIndexableSourcePath` 미존재로 파일 로드 실패.

- [ ] **Step 4: 구현**

`src/infrastructure/usage/php-usage-index.ts`:

1. import 추가:
```ts
import { scanJsCalls } from '../../domain/code-analysis/js-call-scanner';
```

2. `updateFileText`(50-84행) 전체를 다음으로 교체:
```ts
  /** 파일 단위 증분: 기존 항목 제거 후 재추출 (저장 시 호출). 확장자로 PHP/JS 추출기를 고른다. */
  updateFileText(uri: string, text: string): void {
    const prev = this.byFile.get(uri);
    if (prev) { for (const e of prev) this.removeEntry(e); this.byFile.delete(uri); }
    const prevT = this.templatesByFile.get(uri);
    if (prevT) { for (const e of prevT) this.removeTemplateEntry(e); this.templatesByFile.delete(uri); }

    const { entries, tEntries } = uri.endsWith('.js')
      ? this.extractJs(uri, text)
      : this.extractPhp(uri, text);

    for (const e of entries) this.addEntry(e);
    for (const e of tEntries) this.addTemplateEntry(e);
    if (entries.length) this.byFile.set(uri, entries);
    if (tEntries.length) this.templatesByFile.set(uri, tEntries);
  }

  private extractPhp(uri: string, text: string): { entries: UsageEntry[]; tEntries: TemplateEntry[] } {
    const entries: UsageEntry[] = [];
    const tEntries: TemplateEntry[] = [];
    USAGE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    let lastIdx = 0, lastLine = 0; // 증분 라인 계산 — 전체 접두부 재스캔(O(n²)) 금지
    while ((m = USAGE_RE.exec(text))) {
      for (let i = lastIdx; i < m.index; i++) if (text.charCodeAt(i) === 10) lastLine++;
      lastIdx = m.index;
      const component = m[2] ? normalizeComponent(m[2], this.hasCanonical) : 'core';
      const lineStart = text.lastIndexOf('\n', m.index) + 1;
      const column = m.index - lineStart + m[0].search(/['"]/) + 1; // 키 리터럴 내용 시작 = 첫 따옴표 다음
      entries.push({ component, key: m[1], loc: { uri, line: lastLine, column } });
    }
    TEMPLATE_USAGE_RE.lastIndex = 0;
    let tLastIdx = 0, tLastLine = 0;
    while ((m = TEMPLATE_USAGE_RE.exec(text))) {
      for (let i = tLastIdx; i < m.index; i++) if (text.charCodeAt(i) === 10) tLastLine++;
      tLastIdx = m.index;
      const lineStart = text.lastIndexOf('\n', m.index) + 1;
      const column = m.index - lineStart + m[0].search(/['"]/) + 1;
      tEntries.push({ ref: m[1], loc: { uri, line: tLastLine, column } });
    }
    return { entries, tEntries };
  }

  private extractJs(uri: string, text: string): { entries: UsageEntry[]; tEntries: TemplateEntry[] } {
    const calls = scanJsCalls(text);
    return {
      entries: calls.stringCalls.map(c => ({
        component: normalizeComponent(c.component, this.hasCanonical),
        key: c.key,
        loc: { uri, line: c.keyLine, column: c.keyColumn },
      })),
      tEntries: calls.templateCalls.map(c => ({ ref: c.ref, loc: { uri, line: c.refLine, column: c.refColumn } })),
    };
  }
```

3. `listPhpFiles`(119-141행)를 다음으로 교체 — 파일 채택을 술어 하나로 통일:
```ts
/** 루트 재귀 소스 파일(.php/.js) 열거 — realpath 순환 가드, 채택 여부는 isIndexableSourcePath로 통일해
 *  콜드 스캔과 저장 증분의 제외 규칙이 갈라지지 않게 한다. */
async function listSourceFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  async function walk(dir: string): Promise<void> {
    let real: string;
    try { real = await fs.promises.realpath(dir); } catch { return; }
    if (seen.has(real)) return;
    seen.add(real);
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const d of entries) {
      if (SKIP_DIRS.has(d.name)) continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) await walk(p);
      else if (d.isSymbolicLink()) {
        try { if ((await fs.promises.stat(p)).isDirectory()) await walk(p); } catch { /* 깨진 링크 무시 */ }
      } else if (d.isFile() && isIndexableSourcePath(root, p)) out.push(p);
    }
  }
  await walk(root);
  return out;
}
```
그리고 `buildFromRoot`의 `await listPhpFiles(root)`를 `await listSourceFiles(root)`로.

4. `isIndexablePhpPath`(143-149행)를 다음으로 교체:
```ts
/** 콜드 스캔과 저장 증분이 같은 제외 규칙을 쓰게 하는 단일 술어.
 *  amd/build는 amd/src의 미니파이 사본이라 색인하면 참조가 중복되고 생성 파일로 점프한다. */
export function isIndexableSourcePath(root: string, fsPath: string): boolean {
  if (!fsPath.endsWith('.php') && !fsPath.endsWith('.js')) return false;
  if (fsPath.endsWith('.min.js')) return false;
  const rel = path.relative(root, fsPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const segs = rel.split(path.sep);
  if (segs.some(seg => SKIP_DIRS.has(seg))) return false;
  return !segs.some((seg, i) => seg === 'build' && segs[i - 1] === 'amd');
}
```

`src/extension.ts`:
- import 줄의 `isIndexablePhpPath`를 `isIndexableSourcePath`로.
- 저장 핸들러 조건에서 `d.languageId === 'php' && `를 제거하고 술어만 남긴다(확장자가 언어를 결정):
```ts
  ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument(d => {
    if (d.uri.scheme === 'file' && usageIndex.isBuilt && isIndexableSourcePath(root, d.uri.fsPath)) {
      usageIndex.updateFileText(d.uri.fsPath, d.getText());
    }
  }));
```

- [ ] **Step 5: 테스트 통과 + 회귀 확인**

Run: `npx mocha test/unit/infra/php-usage-index.test.ts && npm run test:unit && npx tsc -noEmit`
Expected: 신규 4건 녹색 — 169건(165+4). 기존 PHP 사용처 테스트가 그대로 녹색이어야 한다(추출 리팩토링 등가성).

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/usage/php-usage-index.ts src/extension.ts test/fixtures/mini-moodle/local/ubattend/amd test/unit/infra/php-usage-index.test.ts
git commit -m "feat(infra): 사용처 색인에 JS 포함 — amd/build·.min.js 제외 술어 통일"
```

---

### Task 3: JS 유즈케이스 3개

**Files:**
- Create: `src/application/resolve-js-definition.ts`, `src/application/describe-js-symbol.ts`, `src/application/list-resolved-js-calls.ts`
- Test: `test/unit/application/js-usecases.test.ts`

**Interfaces:**
- Consumes: Task 1 `scanJsCalls`, 기존 `StringRepository`·`TemplateRepository`·`parseTemplateRef`·`DefinitionResult`·`HoverResult`·`RangeItem`.
- Produces (Task 4가 소비):
```ts
ResolveJsDefinition(strings: StringRepository, templates: TemplateRepository).run(text, atIndex): DefinitionResult[]
DescribeJsSymbol(strings, templates).run(text, atIndex): HoverResult | null
ListResolvedJsCalls(strings, templates).run(text): RangeItem[]
```

- [ ] **Step 1: 실패하는 테스트 작성**

`test/unit/application/js-usecases.test.ts` 신규:
```ts
import { strict as assert } from 'assert';
import { join } from 'path';
import { StringIndexStore } from '../../../src/infrastructure/lang/string-index-store';
import { TemplateIndex } from '../../../src/infrastructure/templates/template-index';
import { ResolveJsDefinition } from '../../../src/application/resolve-js-definition';
import { DescribeJsSymbol } from '../../../src/application/describe-js-symbol';
import { ListResolvedJsCalls } from '../../../src/application/list-resolved-js-calls';

const root = join(__dirname, '../../fixtures/mini-moodle');
const strings = new StringIndexStore();
strings.buildFromRoot(root);
const templates = new TemplateIndex();
templates.buildFromRoot(root);

const CODE = `define(['core/str'], function(str) {
    str.get_string('attendance_book', 'local_ubattend');
    Templates.render('local_ubattend/setting', {});
    str.get_string('missing_key', 'local_ubattend');
    Templates.render('local_ubattend/nope', {});
});
`;

describe('JS 유즈케이스 (E2E)', () => {
  const resolve = new ResolveJsDefinition(strings, templates);
  const describe_ = new DescribeJsSymbol(strings, templates);
  const list = new ListResolvedJsCalls(strings, templates);

  it('정의 이동: 문자열 키 → lang ko·en 두 위치', () => {
    const at = CODE.indexOf('attendance_book') + 3;
    const locs = resolve.run(CODE, at);
    assert.equal(locs.length, 2);
    assert.ok(locs.some(l => l.location.uri.endsWith(join('lang', 'ko', 'local_ubattend.php'))));
  });
  it('정의 이동: 템플릿 ref → 원본+오버라이드 두 위치', () => {
    const at = CODE.indexOf('local_ubattend/setting') + 3;
    const locs = resolve.run(CODE, at);
    assert.equal(locs.length, 2);
    assert.ok(locs.every(l => l.location.uri.endsWith('setting.mustache')));
  });
  it('정의 이동: 커서가 리터럴 밖이면 빈 배열', () =>
    assert.deepEqual(resolve.run(CODE, CODE.indexOf('define')), []));
  it('hover: 문자열은 한국어 값 포함', () => {
    const r = describe_.run(CODE, CODE.indexOf('attendance_book') + 3)!;
    assert.match(r.markdown, /출석부/);
  });
  it('hover: 템플릿은 컴포넌트·이름 표시', () => {
    const r = describe_.run(CODE, CODE.indexOf('local_ubattend/setting') + 3)!;
    assert.match(r.markdown, /local_ubattend/);
    assert.match(r.markdown, /setting/);
  });
  it('해석 범위: 존재하는 것만(누락 키·미존재 템플릿 제외)', () => {
    const r = list.run(CODE);
    assert.equal(r.length, 2);
    assert.deepEqual(r.map(x => x.length).sort((a, b) => a - b),
      ['attendance_book'.length, 'local_ubattend/setting'.length].sort((a, b) => a - b));
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx mocha test/unit/application/js-usecases.test.ts`
Expected: FAIL — 유즈케이스 모듈 미존재.

- [ ] **Step 3: 구현**

`src/application/resolve-js-definition.ts`:
```ts
import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { TemplateRepository } from '../domain/template-model/ports/template-repository';
import { parseTemplateRef } from '../domain/template-model/template-ref';
import { scanJsCalls } from '../domain/code-analysis/js-call-scanner';
import { DefinitionResult } from './dto';

/** JS 파일에서 커서가 놓인 리터럴(문자열 키 또는 템플릿 ref)의 정의 위치 */
export class ResolveJsDefinition {
  constructor(private strings: StringRepository, private templates: TemplateRepository) {}
  run(text: string, atIndex: number): DefinitionResult[] {
    const calls = scanJsCalls(text);
    const s = calls.stringCalls.find(c => c.keyIndex <= atIndex && atIndex <= c.keyIndex + c.key.length);
    if (s) {
      const found = this.strings.getString(s.component, s.key);
      if (!found) return [];
      const out: DefinitionResult[] = [];
      if (found.ko) out.push({ location: found.ko.location });
      if (found.en) out.push({ location: found.en.location });
      return out;
    }
    const t = calls.templateCalls.find(c => c.refIndex <= atIndex && atIndex <= c.refIndex + c.ref.length);
    if (!t) return [];
    const ref = parseTemplateRef(t.ref);
    if (!ref) return [];
    return this.templates.locationsOf(ref.component, ref.name).map(location => ({ location }));
  }
}
```

`src/application/describe-js-symbol.ts`:
```ts
import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { TemplateRepository } from '../domain/template-model/ports/template-repository';
import { parseTemplateRef } from '../domain/template-model/template-ref';
import { scanJsCalls } from '../domain/code-analysis/js-call-scanner';
import { HoverResult } from './dto';

export class DescribeJsSymbol {
  constructor(private strings: StringRepository, private templates: TemplateRepository) {}
  run(text: string, atIndex: number): HoverResult | null {
    const calls = scanJsCalls(text);
    const s = calls.stringCalls.find(c => c.keyIndex <= atIndex && atIndex <= c.keyIndex + c.key.length);
    if (s) {
      const found = this.strings.getString(s.component, s.key);
      if (!found) return null;
      const parts = [`**${s.component} / ${s.key}**`];
      if (found.ko) parts.push(`ko: ${found.ko.value}`);
      if (found.en) parts.push(`en: ${found.en.value}`);
      return { markdown: parts.join('\n\n') };
    }
    const t = calls.templateCalls.find(c => c.refIndex <= atIndex && atIndex <= c.refIndex + c.ref.length);
    if (!t) return null;
    const ref = parseTemplateRef(t.ref);
    if (!ref) return null;
    const locs = this.templates.locationsOf(ref.component, ref.name);
    if (!locs.length) return null;
    return { markdown: [`**${ref.component} / ${ref.name}**`, ...locs.map(l => l.uri)].join('\n\n') };
  }
}
```

`src/application/list-resolved-js-calls.ts`:
```ts
import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { TemplateRepository } from '../domain/template-model/ports/template-repository';
import { parseTemplateRef } from '../domain/template-model/template-ref';
import { scanJsCalls } from '../domain/code-analysis/js-call-scanner';
import { RangeItem } from './dto';

/** 색인에 존재하는 JS 참조(문자열 키·템플릿 ref)의 범위 — 하이라이트용 */
export class ListResolvedJsCalls {
  constructor(private strings: StringRepository, private templates: TemplateRepository) {}
  run(text: string): RangeItem[] {
    const calls = scanJsCalls(text);
    const out: RangeItem[] = [];
    for (const c of calls.stringCalls) {
      if (!this.strings.getString(c.component, c.key)) continue;
      out.push({ line: c.keyLine, column0: c.keyColumn, length: c.key.length });
    }
    for (const c of calls.templateCalls) {
      const ref = parseTemplateRef(c.ref);
      if (!ref || !this.templates.has(ref.component, ref.name)) continue;
      out.push({ line: c.refLine, column0: c.refColumn, length: c.ref.length });
    }
    return out;
  }
}
```

- [ ] **Step 4: 테스트 통과 + 회귀 확인**

Run: `npx mocha test/unit/application/js-usecases.test.ts && npm run test:unit && npx tsc -noEmit`
Expected: 신규 6건 녹색 — 175건(169+6).

- [ ] **Step 5: Commit**

```bash
git add src/application/resolve-js-definition.ts src/application/describe-js-symbol.ts src/application/list-resolved-js-calls.ts test/unit/application/js-usecases.test.ts
git commit -m "feat(app): JS 정의·hover·해석 범위 유즈케이스"
```

---

### Task 4: JS 프로바이더 + 하이라이트 언어 필터 + 결선

**Files:**
- Create: `src/presentation/providers/js-definition-provider.ts`, `src/presentation/providers/js-hover-provider.ts`
- Modify: `src/presentation/resolved-highlight.ts`, `src/extension.ts`, `package.json`

**Interfaces:**
- Consumes: Task 3 유즈케이스 3개.
- Produces: `HighlightSource`에 `languages: string[]` 추가(기존 두 소스는 `['php']`).

- [ ] **Step 1: 프로바이더 2개 생성**

`src/presentation/providers/js-definition-provider.ts`:
```ts
import * as vscode from 'vscode';
import { ResolveJsDefinition } from '../../application/resolve-js-definition';
import { toVscodeLocation } from '../mappers';

export class JsDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private uc: ResolveJsDefinition) {}
  provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): vscode.Location[] {
    return this.uc.run(doc.getText(), doc.offsetAt(pos)).map(r => toVscodeLocation(r.location));
  }
}
```

`src/presentation/providers/js-hover-provider.ts`:
```ts
import * as vscode from 'vscode';
import { DescribeJsSymbol } from '../../application/describe-js-symbol';

export class JsHoverProvider implements vscode.HoverProvider {
  constructor(private uc: DescribeJsSymbol) {}
  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | null {
    const r = this.uc.run(doc.getText(), doc.offsetAt(pos));
    return r ? new vscode.Hover(new vscode.MarkdownString(r.markdown)) : null;
  }
}
```

- [ ] **Step 2: 하이라이트에 언어 필터 추가**

`src/presentation/resolved-highlight.ts`에서 인터페이스와 두 가드를 교체:

인터페이스(8행):
```ts
/** 하이라이트 범위 공급자 — 대상 언어, 설정 키(csmscode 하위), 범위 계산을 함께 넘긴다. */
export interface HighlightSource { setting: string; languages: string[]; run(text: string): RangeItem[]; }
```

`refresh`의 가드(18행)와 소스 필터(21-23행)를 교체:
```ts
    if (doc.uri.scheme !== 'file') return;
    const forLang = sources.filter(s => s.languages.includes(doc.languageId));
    if (!forLang.length) return;
    const cfg = vscode.workspace.getConfiguration('csmscode');
    const text = doc.getText();
    const ranges = forLang
      .filter(s => cfg.get(s.setting, true))
      .flatMap(s => s.run(text))
      .map(r => new vscode.Range(r.line, r.column0, r.line, r.column0 + r.length));
```

`onDidChangeTextDocument` 가드(32행)를 교체:
```ts
      const langs = new Set(sources.flatMap(s => s.languages));
      if (!langs.has(e.document.languageId) || e.document.uri.scheme !== 'file') return; // 가드 선행 — 타이머 churn 방지
```

- [ ] **Step 3: extension.ts 결선**

1. import 추가:
```ts
import { ResolveJsDefinition } from './application/resolve-js-definition';
import { DescribeJsSymbol } from './application/describe-js-symbol';
import { ListResolvedJsCalls } from './application/list-resolved-js-calls';
import { JsDefinitionProvider } from './presentation/providers/js-definition-provider';
import { JsHoverProvider } from './presentation/providers/js-hover-provider';
```

2. `const listResolvedTpl = ...` 다음에:
```ts
  const resolveJs = new ResolveJsDefinition(strings, templates);
  const describeJs = new DescribeJsSymbol(strings, templates);
  const listResolvedJs = new ListResolvedJsCalls(strings, templates);
  const js: vscode.DocumentSelector = { language: 'javascript', scheme: 'file' };
```

3. 프로바이더 등록 블록에 두 줄 추가:
```ts
    vscode.languages.registerDefinitionProvider(js, new JsDefinitionProvider(resolveJs)),
    vscode.languages.registerHoverProvider(js, new JsHoverProvider(describeJs)),
```

4. `registerResolvedHighlight(...)` 호출을 다음으로 교체(기존 두 소스에 `languages` 추가 + JS 소스):
```ts
  registerResolvedHighlight(ctx, [
    { setting: 'strings.highlightResolved', languages: ['php'], run: t => listResolved.run(t) },
    { setting: 'templates.highlightResolved', languages: ['php'], run: t => listResolvedTpl.run(t) },
    { setting: 'strings.highlightResolved', languages: ['javascript'], run: t => listResolvedJs.run(t) },
  ]);
```

- [ ] **Step 4: package.json 활성화 이벤트**

`activationEvents` 배열의 `"onLanguage:php",` 다음 줄에 추가:
```json
    "onLanguage:javascript",
```

- [ ] **Step 5: 전체 검증**

Run: `npm run test:unit && npm run lint && npm run compile && npx tsc -p tsconfig.test.json && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('json ok')"`
Expected: 전부 통과 — 175건 유지(이 태스크는 유닛 테스트를 늘리지 않는다), package.json 유효.

- [ ] **Step 6: Commit**

```bash
git add src/presentation src/extension.ts package.json
git commit -m "feat(presentation): JS 정의·hover 프로바이더 + 하이라이트 언어 필터 결선"
```

---

### Task 5: 문서 갱신 + 최종 검증

**Files:**
- Modify: `README.md`, `docs/manual-verification.md`, `docs/PHASE2-BACKLOG.md`

**Interfaces:**
- Consumes: Task 1~4 완료 상태 (코드 변경 없음).
- Produces: 갱신된 문서.

- [ ] **Step 1: README 기능 줄 추가**

`README.md`의 Mustache 기능 줄 다음에 추가:
```markdown
- **JS/AMD 인텔리전스**: `amd/src`의 `get_string`(`M.util.`·`core/str` 모두)·`Templates.render` 리터럴에 정의 이동·hover·하이라이팅, lang/템플릿 참조 목록에 JS 호출처 포함 (`amd/build`·`.min.js`는 생성물이라 제외)
```

- [ ] **Step 2: 수동 검증 항목 추가**

`docs/manual-verification.md`의 18번 다음에 추가:
```markdown
19. `local/*/amd/src/*.js`에서 `M.util.get_string('key','local_x')`의 키 위에 F12 → lang 파일로 이동, hover → 한국어 값
20. 같은 파일에서 `Templates.render('local_x/name')`의 리터럴에 F12 → .mustache로 이동
21. lang 파일에서 Shift+F12 → PHP 호출처와 함께 JS 호출처도 목록에 나타남(단, `amd/build`의 미니파이 사본은 나타나지 않아야 함)
```

"## 알려진 제한" 문단 끝에 이어서 추가:
```markdown
JS/AMD는 AST가 아닌 정규식으로 인식하므로 주석이나 문자열 안의 호출도 이동·hover 대상이 될 수 있습니다
(그래서 JS에는 진단을 제공하지 않습니다). `getStrings([...])` 배열 형태와 TypeScript 소스는 지원하지 않습니다.
```

- [ ] **Step 3: 백로그 갱신**

`docs/PHASE2-BACKLOG.md`의 "## Plan 2" 섹션에서 Mustache 완료 불릿 다음에 추가:
```markdown
- ~~**JS/AMD 인텔리전스**~~ — ✅ 완료 (2026-08-05, 설계: `docs/superpowers/specs/2026-08-05-js-amd-intelligence-design.md`). amd/src의 get_string·Templates.render에 이동·hover·하이라이트, 참조 목록 통합. 비목표: JS 진단(AST 부재로 오탐 위험)·JS 자동완성·getStrings 배열·TypeScript.
```

- [ ] **Step 4: 최종 전체 검증**

Run: `npm run test:unit && npm run lint && npm run compile && npx tsc -p tsconfig.test.json`
Expected: 전부 통과 — 유닛 175건(158 기존 + 17 신규), eslint, 번들, 테스트 컴파일.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/manual-verification.md docs/PHASE2-BACKLOG.md
git commit -m "docs: JS/AMD 인텔리전스 문서화"
```
