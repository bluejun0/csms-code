# lang→참조 이동 + 해석 키 하이라이팅 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** lang 파일의 `$string['key']`에서 Shift+F12로 모든 `get_string` 사용처로 이동하고, 코드에서 해석되는 get_string 키를 링크 색상으로 하이라이팅한다.

**Architecture:** `StringUsageIndex`(비동기 lazy 스캔 + 저장 시 파일 단위 증분)가 `component→key→위치[]` 사용처 색인을 유지하고, `componentOfLangFile`이 lang 파일 경로를 component로 역산한다. 하이라이팅은 `stringCalls` 팩트(캐시 파싱) × `StringRepository` 조회로 해석 키 범위를 구해 `TextEditorDecorationType`으로 장식한다. 정규화 로직은 도메인 서비스 `normalizeComponent`로 추출해 색인 2개가 공유.

**Tech Stack:** TypeScript (strict), fs.promises(비동기 스캔), mocha + ts-node.

**Spec:** `docs/superpowers/specs/2026-08-05-lang-references-highlight-design.md`

## Global Constraints

- 사용처 색인은 **lazy**: 활성화 시 빌드 금지 — 첫 참조 요청에서만 진행률과 함께 빌드, 이후 저장 단위 증분. 스캔은 비동기(fs.promises + 200파일마다 `setImmediate` 양보), 라인 계산은 **증분 카운트**(O(n²) 금지 — Plan 2 최종 리뷰 교훈).
- 프로바이더는 vscode + application(+주입 인터페이스)만 import — infrastructure 직접 import 금지(컴포지션 루트가 주입).
- 하이라이트 색상은 `new vscode.ThemeColor('textLink.foreground')`, 설정 `csmscode.strings.highlightResolved`(기본 true).
- 침묵 원칙 유지: 변수 key/component 미포착, 역산 실패(component null) 시 빈 결과.
- 유닛: `npm run test:unit`. 커밋 메시지: `feat|fix|docs(scope): 한국어 요약`.

---

### Task 1: normalizeComponent 추출(도메인) + componentOfLangFile 역산

**Files:**
- Create: `src/domain/lang-model/services/component-normalizer.ts`
- Modify: `src/infrastructure/lang/string-index-store.ts` (private normalize → 공유 함수 위임)
- Modify: `src/infrastructure/workspace/moodle-root-resolver.ts` (`componentOfLangFile` 추가)
- Test: `test/unit/domain/component-normalizer.test.ts`(신규), `test/unit/infra/resolver.test.ts`(describe 추가)

**Interfaces:**
- Consumes: 기존 `PLUGIN_TYPES`·`LANG_LOCALES`(resolver 내부 상수), `StringIndexStore.byComponent`.
- Produces: `normalizeComponent(raw: string, hasCanonical: (c: string) => boolean): string`, `componentOfLangFile(root: string, file: string): string | null` — Task 2·4가 소비.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/unit/domain/component-normalizer.test.ts` 신규:

```ts
import { strict as assert } from 'assert';
import { normalizeComponent } from '../../../src/domain/lang-model/services/component-normalizer';

const has = (c: string) => c === 'core_grades';

describe('normalizeComponent', () => {
  it("''/'moodle'/'core' → core", () => {
    for (const raw of ['', 'moodle', 'core', ' core ']) assert.equal(normalizeComponent(raw, has), 'core');
  });
  it('_ 포함은 그대로 (core_grades/mod_assign/local_ubattend)', () => {
    for (const raw of ['core_grades', 'mod_assign', 'local_ubattend']) assert.equal(normalizeComponent(raw, has), raw);
  });
  it('bare 이름: core_<s>가 존재하면 코어 서브시스템', () =>
    assert.equal(normalizeComponent('grades', has), 'core_grades'));
  it('bare 이름: 아니면 레거시 mod 단축', () =>
    assert.equal(normalizeComponent('assign', has), 'mod_assign'));
});
```

`test/unit/infra/resolver.test.ts` — import에 `componentOfLangFile` 추가, 파일 끝에 describe 추가:

```ts
describe('MoodleRootResolver — componentOfLangFile (경로 역산)', () => {
  it('코어: lang/en/moodle.php → core', () =>
    assert.equal(componentOfLangFile(root, join(root, 'lang/en/moodle.php')), 'core'));
  it('코어 서브시스템: lang/en/grades.php → core_grades', () =>
    assert.equal(componentOfLangFile(root, join(root, 'lang/en/grades.php')), 'core_grades'));
  it('플러그인: local/ubattend/lang/ko/local_ubattend.php → local_ubattend', () =>
    assert.equal(componentOfLangFile(root, join(root, 'local/ubattend/lang/ko/local_ubattend.php')), 'local_ubattend'));
  it('mod 파일명 예외: mod/testmod/lang/en/testmod.php → mod_testmod', () =>
    assert.equal(componentOfLangFile(root, join(root, 'mod/testmod/lang/en/testmod.php')), 'mod_testmod'));
  it('규칙 밖 파일명 → null', () =>
    assert.equal(componentOfLangFile(root, join(root, 'local/ubattend/lang/ko/wrong.php')), null));
  it('루트 밖 경로 → null', () =>
    assert.equal(componentOfLangFile(root, '/etc/passwd'), null));
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx mocha test/unit/domain/component-normalizer.test.ts test/unit/infra/resolver.test.ts`
Expected: 두 파일 모두 로드 실패(모듈/`componentOfLangFile` export 미존재) — GREEN 단계에서 기존 resolver 테스트 복귀 확인.

- [ ] **Step 3: 구현**

`src/domain/lang-model/services/component-normalizer.ts` 신규:

```ts
/** raw component → canonical 색인 키. bare 이름은 코어 서브시스템(core_<s> 존재) 우선, 아니면 레거시 mod 단축.
 *  존재 판정은 주입(hasCanonical) — 도메인은 색인 구현을 모른다. */
export function normalizeComponent(raw: string, hasCanonical: (c: string) => boolean): string {
  const s = raw.trim();
  if (!s || s === 'moodle' || s === 'core') return 'core';
  if (s.includes('_')) return s;
  if (hasCanonical(`core_${s}`)) return `core_${s}`;
  return `mod_${s}`;
}
```

`src/infrastructure/lang/string-index-store.ts` — import 추가 후 `private normalize` 본문을 위임으로 교체:

```ts
import { normalizeComponent } from '../../domain/lang-model/services/component-normalizer';
```
```ts
  private normalize(raw: string): string {
    return normalizeComponent(raw, c => this.byComponent.has(c));
  }
```
(기존 normalize의 규칙 주석·구현 줄들은 제거 — 공유 함수가 규칙의 단일 출처.)

`src/infrastructure/workspace/moodle-root-resolver.ts` — 파일 끝에 추가:

```ts
/** lang 파일 경로 → component (listLangFiles 규칙의 역함수 — 순수 경로 로직). 규칙 밖은 null. */
export function componentOfLangFile(root: string, file: string): string | null {
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (parts.length === 3 && parts[0] === 'lang' && parts[1] === 'en' && parts[2].endsWith('.php')) {
    const base = parts[2].slice(0, -4);
    return base === 'moodle' ? 'core' : `core_${base}`;
  }
  if (parts.length === 5 && parts[2] === 'lang' && LANG_LOCALES.includes(parts[3]) && parts[4].endsWith('.php')) {
    const [type, name] = parts;
    if (!PLUGIN_TYPES.includes(type)) return null;
    const expected = type === 'mod' ? `${name}.php` : `${type}_${name}.php`;
    return parts[4] === expected ? `${type}_${name}` : null;
  }
  return null;
}
```

- [ ] **Step 4: 테스트 통과 + 회귀 확인**

Run: `npx mocha test/unit/domain/component-normalizer.test.ts test/unit/infra/resolver.test.ts test/unit/infra/string-index.test.ts && npm run test:unit && npx tsc -noEmit`
Expected: 신규 10건 녹색 + **기존 string-index 7건 그대로 녹색**(normalize 추출 등가성 핀) — 총 112건(102+10).

- [ ] **Step 5: Commit**

```bash
git add src/domain/lang-model/services/component-normalizer.ts src/infrastructure/lang/string-index-store.ts src/infrastructure/workspace/moodle-root-resolver.ts test/unit/domain/component-normalizer.test.ts test/unit/infra/resolver.test.ts
git commit -m "feat(domain): normalizeComponent 공유 추출 + lang 경로→component 역산"
```

---

### Task 2: StringUsageIndex — 비동기 사용처 색인 + 증분

**Files:**
- Create: `src/domain/lang-model/ports/string-usage-repository.ts`, `src/infrastructure/lang/string-usage-index.ts`
- Create: 픽스처 `test/fixtures/mini-moodle/local/ubattend/view.php`
- Test: `test/unit/infra/string-usage-index.test.ts`

**Interfaces:**
- Consumes: Task 1 `normalizeComponent`, 기존 `SourceLocation`.
- Produces:
```ts
export interface StringUsageRepository { referencesOf(component: string, key: string): SourceLocation[]; }
export class StringUsageIndex implements StringUsageRepository {
  constructor(hasCanonical: (c: string) => boolean)
  get isBuilt(): boolean
  buildFromRoot(root: string, onProgress?: (done: number, total: number) => void): Promise<void>
  updateFileText(uri: string, text: string): void
  referencesOf(component: string, key: string): SourceLocation[]
}
```
Task 3·4가 소비. `referencesOf`의 component는 canonical.

- [ ] **Step 1: 픽스처 생성**

`test/fixtures/mini-moodle/local/ubattend/view.php` (정확히 그대로):
```php
<?php
echo get_string('attendance_book', 'local_ubattend');
echo get_string('pluginname', 'testmod');
echo get_string('ok');
echo get_string($dynamic, 'local_ubattend');
```

- [ ] **Step 2: 실패하는 테스트 작성**

`test/unit/infra/string-usage-index.test.ts` 신규:

```ts
import { strict as assert } from 'assert';
import { join } from 'path';
import { StringUsageIndex } from '../../../src/infrastructure/lang/string-usage-index';

const root = join(__dirname, '../../fixtures/mini-moodle');
// 픽스처 기준 canonical 존재 판정: 코어 서브시스템은 core_grades뿐
const hasCanonical = (c: string) => ['core', 'core_grades', 'local_ubattend', 'mod_testmod'].includes(c);

describe('StringUsageIndex', () => {
  const idx = new StringUsageIndex(hasCanonical);
  let progressed = 0;
  before(async function () {
    assert.equal(idx.isBuilt, false, '빌드 전 isBuilt=false');
    await idx.buildFromRoot(root, () => { progressed++; });
    // mocha 최상위 before 금지 규칙과 무관 — describe 내부 before
  });

  it('빌드 후 isBuilt=true + 진행률 콜백 호출', () => {
    assert.equal(idx.isBuilt, true);
    assert.ok(progressed >= 1, '최소 1회(완료 시점) 호출');
  });
  it('canonical 호출: 위치(줄·컬럼) 정확', () => {
    const refs = idx.referencesOf('local_ubattend', 'attendance_book');
    assert.equal(refs.length, 1);
    assert.ok(refs[0].uri.endsWith('local/ubattend/view.php'));
    assert.equal(refs[0].line, 1);        // 0-based — 2번째 줄
    assert.equal(refs[0].column, 17);     // "echo get_string('" 다음 = 키 시작
  });
  it("레거시 bare component('testmod')는 mod_testmod로 canonical 귀속", () => {
    assert.equal(idx.referencesOf('mod_testmod', 'pluginname').length, 1);
    assert.equal(idx.referencesOf('testmod', 'pluginname').length, 0, '조회는 canonical만');
  });
  it("한 인자 호출은 core 귀속", () => {
    assert.equal(idx.referencesOf('core', 'ok').length, 1);
  });
  it('변수 키 호출은 미포착', () => {
    // view.php의 local_ubattend 호출은 attendance_book 1건뿐($dynamic은 비포착)
    assert.equal(idx.referencesOf('local_ubattend', 'attendance_book').length, 1);
  });
  it('updateFileText: 항목 교체·제거(증분)', () => {
    const uri = join(root, 'local/ubattend/view.php');
    idx.updateFileText(uri, "<?php\necho get_string('attendance_rate', 'local_ubattend');\n");
    assert.equal(idx.referencesOf('local_ubattend', 'attendance_book').length, 0, '이전 항목 제거');
    assert.equal(idx.referencesOf('local_ubattend', 'attendance_rate').length, 1, '새 항목 반영');
    idx.updateFileText(uri, '<?php\n');
    assert.equal(idx.referencesOf('local_ubattend', 'attendance_rate').length, 0, '전부 제거');
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx mocha test/unit/infra/string-usage-index.test.ts`
Expected: FAIL — 모듈 미존재.

- [ ] **Step 4: 구현**

`src/domain/lang-model/ports/string-usage-repository.ts`:
```ts
import { SourceLocation } from '../../shared/value-objects';
export interface StringUsageRepository {
  referencesOf(component: string, key: string): SourceLocation[];
}
```

`src/infrastructure/lang/string-usage-index.ts`:
```ts
import * as fs from 'fs';
import * as path from 'path';
import { SourceLocation } from '../../domain/shared/value-objects';
import { StringUsageRepository } from '../../domain/lang-model/ports/string-usage-repository';
import { normalizeComponent } from '../../domain/lang-model/services/component-normalizer';

// 리터럴 key(+선택적 리터럴 component) — 변수/보간은 비매칭(침묵 원칙)
const USAGE_RE = /get_string\(\s*['"]([\w:.\/-]+)['"]\s*(?:,\s*['"](\w+)['"])?/g;
// 'lang'은 lang 팩 자체 — 사용처가 아니고, 값 텍스트 속 "get_string(" 유령 매치 방지를 겸한다
const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', '.superpowers', 'dist', 'lang']);
const YIELD_EVERY = 200;

interface UsageEntry { component: string; key: string; loc: SourceLocation; }

/** get_string 사용처의 워크스페이스 색인 — lazy 빌드 + 저장 시 파일 단위 증분.
 *  메모리: 호출당 항목 1개(수만 건 × ~100B = 수 MB). */
export class StringUsageIndex implements StringUsageRepository {
  private byComponent = new Map<string, Map<string, SourceLocation[]>>();
  private byFile = new Map<string, UsageEntry[]>();
  private builtFlag = false;

  constructor(private hasCanonical: (c: string) => boolean) {}

  get isBuilt(): boolean { return this.builtFlag; }

  async buildFromRoot(root: string, onProgress?: (done: number, total: number) => void): Promise<void> {
    const files = await listPhpFiles(root);
    let done = 0;
    for (const f of files) {
      let text: string;
      try { text = await fs.promises.readFile(f, 'utf8'); } catch { done++; continue; }
      this.updateFileText(f, text);
      done++;
      if (done % YIELD_EVERY === 0) {
        onProgress?.(done, files.length);
        await new Promise<void>(r => setImmediate(r)); // 이벤트 루프 양보 — 확장 호스트 블록 방지
      }
    }
    onProgress?.(files.length, files.length);
    this.builtFlag = true;
  }

  /** 파일 단위 증분: 기존 항목 제거 후 재추출 (저장 시 호출) */
  updateFileText(uri: string, text: string): void {
    const prev = this.byFile.get(uri);
    if (prev) { for (const e of prev) this.removeEntry(e); this.byFile.delete(uri); }
    const entries: UsageEntry[] = [];
    USAGE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    let lastIdx = 0, lastLine = 0; // 증분 라인 계산 — 전체 접두부 재스캔(O(n²)) 금지
    while ((m = USAGE_RE.exec(text))) {
      for (let i = lastIdx; i < m.index; i++) if (text.charCodeAt(i) === 10) lastLine++;
      lastIdx = m.index;
      const component = m[2] ? normalizeComponent(m[2], this.hasCanonical) : 'core';
      const lineStart = text.lastIndexOf('\n', m.index) + 1;
      const column = m.index - lineStart + m[0].indexOf(m[1]); // 키 리터럴 내용 시작 컬럼
      const e: UsageEntry = { component, key: m[1], loc: { uri, line: lastLine, column } };
      entries.push(e);
      this.addEntry(e);
    }
    if (entries.length) this.byFile.set(uri, entries);
  }

  referencesOf(component: string, key: string): SourceLocation[] {
    return this.byComponent.get(component)?.get(key) ?? [];
  }

  private addEntry(e: UsageEntry): void {
    let comp = this.byComponent.get(e.component);
    if (!comp) { comp = new Map(); this.byComponent.set(e.component, comp); }
    let arr = comp.get(e.key);
    if (!arr) { arr = []; comp.set(e.key, arr); }
    arr.push(e.loc);
  }
  private removeEntry(e: UsageEntry): void {
    const arr = this.byComponent.get(e.component)?.get(e.key);
    if (!arr) return;
    const i = arr.indexOf(e.loc);
    if (i >= 0) arr.splice(i, 1);
  }
}

/** 루트 재귀 PHP 파일 열거 — realpath 기준 순환 가드로 symlink 디렉터리도 안전하게 추적 */
async function listPhpFiles(root: string): Promise<string[]> {
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
      } else if (d.isFile() && d.name.endsWith('.php')) out.push(p);
    }
  }
  await walk(root);
  return out;
}
```

- [ ] **Step 5: 테스트 통과 + 회귀 확인**

Run: `npx mocha test/unit/infra/string-usage-index.test.ts && npm run test:unit && npx tsc -noEmit`
Expected: 신규 6건 녹색 — 총 118건(112+6). 픽스처 view.php 추가가 기존 열거·색인 테스트에 영향 없는지 확인(install.xml·lang 열거와 무관).

- [ ] **Step 6: Commit**

```bash
git add src/domain/lang-model/ports/string-usage-repository.ts src/infrastructure/lang/string-usage-index.ts test/fixtures/mini-moodle/local/ubattend/view.php test/unit/infra/string-usage-index.test.ts
git commit -m "feat(infra): StringUsageIndex — get_string 사용처 비동기 색인 + 저장 증분"
```

---

### Task 3: 앱 레이어 — FindStringReferences + ListResolvedStringCalls

**Files:**
- Create: `src/application/find-string-references.ts`, `src/application/list-resolved-string-calls.ts`
- Modify: `src/application/dto.ts` (`RangeItem` 추가)
- Test: `test/unit/application/string-usecases.test.ts` (describe 추가)

**Interfaces:**
- Consumes: Task 2 `StringUsageRepository`, 기존 `PhpSyntax`·`StringRepository`·`SourceLocation`.
- Produces (Task 4가 소비):
```ts
export interface RangeItem { line: number; column0: number; length: number; }
FindStringReferences.run(component: string, key: string): SourceLocation[]
ListResolvedStringCalls.run(text: string): RangeItem[]
```

- [ ] **Step 1: 실패하는 테스트 작성**

`test/unit/application/string-usecases.test.ts` 파일 끝에 추가 (파일 상단 import에 두 유즈케이스 추가):

```ts
import { ListResolvedStringCalls } from '../../../src/application/list-resolved-string-calls';
import { FindStringReferences } from '../../../src/application/find-string-references';
```

```ts
describe('참조·하이라이트 유즈케이스', () => {
  it('ListResolvedStringCalls: 해석되는 키 범위만 (누락 키·미색인 component 제외)', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const r = new ListResolvedStringCalls(syn, store).run(CODE);
    assert.deepEqual(r, [{ line: 2, column0: CODE.split('\n')[2].indexOf('attendance_book'), length: 'attendance_book'.length }]);
  });
  it('FindStringReferences: 포트 위임', () => {
    const fake = { referencesOf: (c: string, k: string) => [{ uri: `${c}/${k}`, line: 0, column: 0 }] };
    assert.equal(new FindStringReferences(fake).run('local_ubattend', 'x')[0].uri, 'local_ubattend/x');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx mocha test/unit/application/string-usecases.test.ts`
Expected: 로드 실패(모듈 미존재). GREEN에서 기존 6건 복귀 확인.

- [ ] **Step 3: 구현**

`src/application/dto.ts`에 추가:
```ts
export interface RangeItem { line: number; column0: number; length: number; }
```

`src/application/find-string-references.ts`:
```ts
import { StringUsageRepository } from '../domain/lang-model/ports/string-usage-repository';
import { SourceLocation } from '../domain/shared/value-objects';

export class FindStringReferences {
  constructor(private usages: StringUsageRepository) {}
  run(component: string, key: string): SourceLocation[] {
    return this.usages.referencesOf(component, key);
  }
}
```

`src/application/list-resolved-string-calls.ts`:
```ts
import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { RangeItem } from './dto';

/** 해석되는(색인에 존재하는) get_string 키의 범위 — 하이라이트용 */
export class ListResolvedStringCalls {
  constructor(private syntax: PhpSyntax, private strings: StringRepository) {}
  run(text: string): RangeItem[] {
    const out: RangeItem[] = [];
    for (const c of this.syntax.facts(text).stringCalls) {
      if (!this.strings.getString(c.component, c.key)) continue;
      out.push({ line: c.keyLine, column0: c.keyColumn, length: c.key.length });
    }
    return out;
  }
}
```

- [ ] **Step 4: 테스트 통과 + 회귀 확인**

Run: `npx mocha test/unit/application/string-usecases.test.ts && npm run test:unit && npx tsc -noEmit`
Expected: 신규 2건 녹색 — 총 120건(118+2).

- [ ] **Step 5: Commit**

```bash
git add src/application/find-string-references.ts src/application/list-resolved-string-calls.ts src/application/dto.ts test/unit/application/string-usecases.test.ts
git commit -m "feat(app): 참조 조회·해석 키 범위 유즈케이스"
```

---

### Task 4: 프레젠테이션 + 결선 + 설정

**Files:**
- Create: `src/presentation/lang-line-key.ts`, `src/presentation/providers/lang-reference-provider.ts`, `src/presentation/string-highlight.ts`
- Modify: `src/extension.ts`, `package.json`
- Test: `test/unit/presentation/lang-line-key.test.ts`

**Interfaces:**
- Consumes: Task 3 유즈케이스 2개, Task 1 `componentOfLangFile`, Task 2 `StringUsageIndex`(컴포지션 루트에서만), 기존 `KeyedDebouncer`·`toVscodeLocation`.
- Produces: 사용자 기능 결선 완료. `langKeyAt(lineText, character): string | null`(vscode 무의존).

- [ ] **Step 1: 실패하는 테스트 작성 (vscode 무의존 헬퍼)**

`test/unit/presentation/lang-line-key.test.ts` 신규:

```ts
import { strict as assert } from 'assert';
import { langKeyAt } from '../../../src/presentation/lang-line-key';

const LINE = "$string['attendance_book'] = '출석부';";

describe('langKeyAt', () => {
  it('커서가 키 내용 위 → 키 반환', () =>
    assert.equal(langKeyAt(LINE, LINE.indexOf('attendance_book') + 3), 'attendance_book'));
  it('커서가 키 시작 앞(여는 따옴표) → null', () =>
    assert.equal(langKeyAt(LINE, LINE.indexOf("'attendance_book'")), null));
  it('커서가 값 영역 → null', () =>
    assert.equal(langKeyAt(LINE, LINE.indexOf('출석부')), null));
  it('$string 패턴 없는 줄 → null', () =>
    assert.equal(langKeyAt('echo $x;', 3), null));
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx mocha test/unit/presentation/lang-line-key.test.ts`
Expected: FAIL — 모듈 미존재.

- [ ] **Step 3: 헬퍼 + 프로바이더 + 하이라이트 구현**

`src/presentation/lang-line-key.ts` (vscode import 금지):
```ts
/** lang 파일의 한 줄에서 커서가 $string['key']의 key 내용 위에 있으면 그 키를 반환 */
export function langKeyAt(lineText: string, character: number): string | null {
  const m = lineText.match(/\$string\[\s*'([^']+)'\s*\]/);
  if (!m || m.index === undefined) return null;
  const keyStart = lineText.indexOf(m[1], m.index);
  return character >= keyStart && character <= keyStart + m[1].length ? m[1] : null;
}
```

`src/presentation/providers/lang-reference-provider.ts`:
```ts
import * as vscode from 'vscode';
import { FindStringReferences } from '../../application/find-string-references';
import { toVscodeLocation } from '../mappers';
import { langKeyAt } from '../lang-line-key';

/** 사용처 색인의 lazy 빌드 핸들 — 컴포지션 루트가 인프라를 감싸 주입(프로바이더는 인프라를 모른다) */
export interface UsageIndexHandle {
  built(): boolean;
  build(onProgress: (done: number, total: number) => void): Promise<void>;
}

export class LangReferenceProvider implements vscode.ReferenceProvider {
  constructor(private uc: FindStringReferences, private usage: UsageIndexHandle,
              private componentOf: (file: string) => string | null) {}

  async provideReferences(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Location[]> {
    const component = this.componentOf(doc.uri.fsPath);
    if (!component) return [];
    const key = langKeyAt(doc.lineAt(pos.line).text, pos.character);
    if (!key) return [];
    if (!this.usage.built()) {
      // 첫 요청에만 워크스페이스 스캔(진행률 알림) — 이후 저장 단위 증분(extension.ts)
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'CSMS Code: get_string 사용처 색인 중…' },
        async progress => {
          let last = 0;
          await this.usage.build((done, total) => {
            const pct = total ? Math.floor((done / total) * 100) : 100;
            progress.report({ increment: pct - last, message: `${done}/${total} 파일` });
            last = pct;
          });
        });
    }
    return this.uc.run(component, key).map(toVscodeLocation);
  }
}
```

`src/presentation/string-highlight.ts`:
```ts
import * as vscode from 'vscode';
import { ListResolvedStringCalls } from '../application/list-resolved-string-calls';
import { KeyedDebouncer } from './keyed-debouncer';

const HIGHLIGHT_DEBOUNCE_MS = 300;

/** 해석되는 get_string 키를 링크 색상으로 장식 — csmscode.strings.highlightResolved(기본 true) */
export function registerStringHighlight(ctx: vscode.ExtensionContext, uc: ListResolvedStringCalls) {
  const deco = vscode.window.createTextEditorDecorationType({ color: new vscode.ThemeColor('textLink.foreground') });
  const debouncer = new KeyedDebouncer(HIGHLIGHT_DEBOUNCE_MS);
  ctx.subscriptions.push(debouncer, deco);

  const refresh = (editor: vscode.TextEditor) => {
    const doc = editor.document;
    if (doc.uri.scheme !== 'file' || doc.languageId !== 'php') return;
    if (!vscode.workspace.getConfiguration('csmscode').get('strings.highlightResolved', true)) {
      editor.setDecorations(deco, []);
      return;
    }
    const ranges = uc.run(doc.getText()).map(r => new vscode.Range(r.line, r.column0, r.line, r.column0 + r.length));
    editor.setDecorations(deco, ranges);
  };

  vscode.window.visibleTextEditors.forEach(refresh);
  ctx.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(e => { if (e) refresh(e); }),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.languageId !== 'php' || e.document.uri.scheme !== 'file') return; // 가드 선행 — 타이머 churn 방지
      debouncer.schedule(e.document.uri.toString(), () => {
        vscode.window.visibleTextEditors.filter(ed => ed.document === e.document).forEach(refresh);
      });
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('csmscode.strings.highlightResolved')) vscode.window.visibleTextEditors.forEach(refresh);
    }),
  );
}
```

- [ ] **Step 4: 헬퍼 테스트 통과 확인**

Run: `npx mocha test/unit/presentation/lang-line-key.test.ts`
Expected: PASS — 4건 녹색.

- [ ] **Step 5: extension.ts 결선 + package.json 설정**

`src/extension.ts`:
1. import 추가:
```ts
import { StringUsageIndex } from './infrastructure/lang/string-usage-index';
import { FindStringReferences } from './application/find-string-references';
import { ListResolvedStringCalls } from './application/list-resolved-string-calls';
import { LangReferenceProvider } from './presentation/providers/lang-reference-provider';
import { registerStringHighlight } from './presentation/string-highlight';
```
그리고 기존 `findMoodleRoot` import 줄에 `componentOfLangFile` 추가.

2. 문자열 유즈케이스 생성부(`validateStr` 아래)에 추가:
```ts
  const usageIndex = new StringUsageIndex(c => strings.hasComponent(c));
  const findRefs = new FindStringReferences(usageIndex);
  const listResolved = new ListResolvedStringCalls(syntax, strings);
```

3. 프로바이더 등록 블록에 추가:
```ts
    vscode.languages.registerReferenceProvider(
      { language: 'php', scheme: 'file', pattern: '**/lang/*/*.php' },
      new LangReferenceProvider(findRefs, {
        built: () => usageIndex.isBuilt,
        build: cb => usageIndex.buildFromRoot(root, cb),
      }, file => componentOfLangFile(root, file))),
```

4. `registerDiagnostics(...)` 호출 다음 줄에:
```ts
  registerStringHighlight(ctx, listResolved);
```

5. lang watcher 블록 다음에 추가:
```ts
  // 사용처 색인 증분: lazy 빌드 이후에만, 저장된 파일 단위로 재추출
  ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument(d => {
    if (d.languageId === 'php' && d.uri.scheme === 'file' && usageIndex.isBuilt) {
      usageIndex.updateFileText(d.uri.fsPath, d.getText());
    }
  }));
```

`package.json` — `contributes.configuration.properties`에 추가(기존 항목 형식 그대로):
```json
"csmscode.strings.highlightResolved": {
  "type": "boolean",
  "default": true,
  "description": "해석되는 get_string 키를 링크 색상(textLink.foreground)으로 하이라이팅합니다."
}
```

- [ ] **Step 6: 전체 검증**

Run: `npm run test:unit && npm run lint && npm run compile && npx tsc -p tsconfig.test.json`
Expected: 전부 통과 — 124건(120+4), eslint, 번들, 테스트 컴파일.

- [ ] **Step 7: Commit**

```bash
git add src/presentation src/extension.ts package.json test/unit/presentation/lang-line-key.test.ts
git commit -m "feat(presentation): lang 참조 프로바이더(lazy 색인) + 해석 키 하이라이트 결선"
```

---

### Task 5: 문서 갱신 + 최종 검증

**Files:**
- Modify: `README.md`, `docs/manual-verification.md`, `docs/PHASE2-BACKLOG.md`

**Interfaces:**
- Consumes: Task 1~4 완료 상태 (코드 변경 없음).
- Produces: 갱신된 문서.

- [ ] **Step 1: README 기능 줄 확장**

`README.md`의 언어 문자열 기능 줄(`- **언어 문자열 인텔리전스**: …`)을 다음으로 교체:
```markdown
- **언어 문자열 인텔리전스**: `get_string('key', 'component')` 키 자동완성(한국어 값 미리보기)·정의로 이동(ko/en)·hover·누락 키 진단·해석 키 하이라이팅, lang 파일에서 사용처 참조 이동(Shift+F12)
```

- [ ] **Step 2: 수동 검증 체크리스트 추가**

`docs/manual-verification.md`의 10번 항목 다음에 추가:
```markdown
11. lang/ko/local_ubattend.php의 $string['attendance_book'] 줄에서 Shift+F12 → 사용처 목록(첫 요청 시 진행률 알림 ~20초, 이후 즉시)
12. 사용처 파일에서 get_string 호출 추가/삭제 후 저장 → 참조 목록에 반영(증분)
13. 해석되는 get_string 키가 링크 색상으로 표시되고, csmscode.strings.highlightResolved=false 설정 시 사라짐
```

"## 알려진 제한" 섹션의 문자열 제한 문단 끝에 이어서 추가:
```markdown
참조 색인은 저장된 파일 기준입니다(미저장 편집은 저장 시 반영). 변수 key/component 호출은
참조·하이라이팅 모두에서 포착되지 않습니다.
```

- [ ] **Step 3: 백로그 기록**

`docs/PHASE2-BACKLOG.md`의 "## Plan 2 (별도 계획 예정)" 섹션에서 Plan 2 완료 불릿 다음 줄에 추가:
```markdown
- ~~**lang→참조 이동 + 해석 키 하이라이팅**~~ — ✅ 완료 (2026-08-05, 설계: `docs/superpowers/specs/2026-08-05-lang-references-highlight-design.md`). 사용처 색인은 lazy(첫 요청, 진행률) + 저장 단위 증분, 하이라이트는 textLink.foreground.
```

- [ ] **Step 4: 최종 전체 검증**

Run: `npm run test:unit && npm run lint && npm run compile && npx tsc -p tsconfig.test.json`
Expected: 전부 통과 — 유닛 124건(102 기존 + 22 신규), eslint, 번들, 테스트 컴파일.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/manual-verification.md docs/PHASE2-BACKLOG.md
git commit -m "docs: 참조 이동·하이라이팅 문서화 — 수동 검증·백로그 갱신"
```
