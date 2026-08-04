# Plan 2: 언어 문자열 인텔리전스 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `get_string('key', 'component')`의 key에 자동완성·정의로 이동·hover(한국어 값)·누락 진단 4기능을 제공한다.

**Architecture:** lang 파일(`$string['k']='v';`)을 `StringIndexStore`(=`StringRepository` 포트 구현)로 색인하고, `DocumentFacts`에 `stringCalls` 팩트를 추가해 기존 파싱 캐시·진단 debounce 파이프라인을 재사용한다. 유즈케이스 4개 + 프로바이더 3개 + 진단 합류. DB 인텔리전스와 대칭 구조.

**Tech Stack:** TypeScript (strict), web-tree-sitter (기존 어댑터에 쿼리 1개 추가), mocha + ts-node.

**Spec:** `docs/superpowers/specs/2026-08-04-lang-string-intelligence-design.md`

## Global Constraints

- `StringCall` 팩트는 **scope 필드 없음** — `scopeContaining`의 타입 가드가 자연 제외하도록(12번 하드닝 검증 사례). `DocumentFacts.stringCalls`는 필수 필드 — 생성처 3곳(어댑터, `inference.test.ts` base, `cached-php-syntax.test.ts` CountingFake) 모두 갱신해야 컴파일된다.
- tree-sitter 쿼리는 인스턴스당 1회 컴파일(`create()`), 함수명 필터는 캡처 후 코드에서(술어 미지원 — Q_DATAARG 선례).
- component 정규화: `''|'moodle'|'core'`→`core`, `_` 포함→그대로, bare→`core_<s>`가 색인에 있으면 그것, 아니면 `mod_<s>`. mod 플러그인 lang 파일명은 `<name>.php`(prefix 없음), 그 외는 `<type>_<name>.php`.
- 진단 오탐 방지: component가 색인에 없으면 침묵. 변수 키/컴포넌트는 팩트 미추출로 자연 침묵.
- 기존 record 기능·테스트 무회귀. 유닛: `npm run test:unit`, 개별: `npx mocha test/unit/<path>.test.ts`.
- 커밋 메시지: `feat|fix|docs(scope): 한국어 요약`.

---

### Task 1: lang 파일 파서 + 열거

**Files:**
- Create: `src/infrastructure/lang/lang-file-parser.ts`
- Modify: `src/infrastructure/workspace/moodle-root-resolver.ts` (`listLangFiles` + `safeReaddirFiles` 추가)
- Create: 픽스처 `test/fixtures/mini-moodle/lang/en/moodle.php`, `test/fixtures/mini-moodle/local/ubattend/lang/en/local_ubattend.php`, `test/fixtures/mini-moodle/local/ubattend/lang/ko/local_ubattend.php`, `test/fixtures/mini-moodle/mod/testmod/lang/en/testmod.php`
- Test: `test/unit/infra/lang-parser.test.ts`(신규), `test/unit/infra/resolver.test.ts`(listLangFiles 검증 추가)

**Interfaces:**
- Consumes: 기존 `PLUGIN_TYPES`, `safeReaddir`(symlink 지원 승계).
- Produces: `parseLangFile(text: string): { key: string; value: string; line: number }[]` (0-based line), `listLangFiles(root: string): { file: string; component: string; locale: string }[]` — Task 2가 소비.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/unit/infra/lang-parser.test.ts` 신규:

```ts
import { strict as assert } from 'assert';
import { parseLangFile } from '../../../src/infrastructure/lang/lang-file-parser';

describe('parseLangFile', () => {
  it('기본: 키·값·라인(0-based)', () => {
    const r = parseLangFile("<?php\n\n$string['attendance_book'] = '출석부';\n");
    assert.deepEqual(r, [{ key: 'attendance_book', value: '출석부', line: 2 }]);
  });
  it("이스케이프: \\' 는 ' 로", () => {
    const r = parseLangFile("<?php\n$string['x'] = 'It\\'s ok';\n");
    assert.equal(r[0].value, "It's ok");
  });
  it('여러 줄 값 + 다음 항목의 라인 정확성', () => {
    const r = parseLangFile("<?php\n$string['a'] = 'line1\nline2';\n$string['b'] = 'B';\n");
    assert.equal(r[0].value, 'line1\nline2');
    assert.deepEqual(r[1], { key: 'b', value: 'B', line: 3 });
  });
  it('{$a} 플레이스홀더는 그대로 보존', () => {
    const r = parseLangFile("<?php\n$string['n'] = '{$a}회차';\n");
    assert.equal(r[0].value, '{$a}회차');
  });
  it("콜론 포함 키('activitydate:lateness') 지원", () => {
    const r = parseLangFile("<?php\n$string['activitydate:lateness'] = '지각';\n");
    assert.equal(r[0].key, 'activitydate:lateness');
  });
});
```

`test/unit/infra/resolver.test.ts` — import에 `listLangFiles` 추가(`findMoodleRoot, listInstallXmlFiles`와 같은 곳), 파일 끝에 추가:

```ts
describe('MoodleRootResolver — lang 파일 열거', () => {
  it('코어(en)·플러그인(en/ko)·mod 파일명 예외를 컴포넌트·locale과 함께 열거', () => {
    const list = listLangFiles(root).map(x => `${x.component}:${x.locale}`).sort();
    assert.deepEqual(list, ['core:en', 'local_ubattend:en', 'local_ubattend:ko', 'mod_testmod:en']);
  });
});
```

- [ ] **Step 2: 픽스처 생성**

```php
// test/fixtures/mini-moodle/lang/en/moodle.php
<?php
$string['ok'] = 'OK';
$string['cancel'] = 'Cancel';
```
```php
// test/fixtures/mini-moodle/local/ubattend/lang/en/local_ubattend.php
<?php
$string['attendance_book'] = 'Attendance book';
$string['attendance_rate'] = 'Attendance rate';
```
```php
// test/fixtures/mini-moodle/local/ubattend/lang/ko/local_ubattend.php
<?php
$string['attendance_book'] = '출석부';
```
```php
// test/fixtures/mini-moodle/mod/testmod/lang/en/testmod.php
<?php
$string['pluginname'] = 'Test module';
```
(각 파일은 위 주석 줄 없이 `<?php`부터 시작해 정확히 그대로 생성한다.)

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx mocha test/unit/infra/lang-parser.test.ts test/unit/infra/resolver.test.ts`
Expected: FAIL — 두 파일 모두 **로드 단계에서 실패**한다(`Cannot find module '.../lang-file-parser'`, `listLangFiles` 미export로 ts-node 컴파일 에러). 미존재 export를 import하는 시점이라 resolver.test.ts의 기존 5건도 이 단계에서는 실행되지 못하는 것이 정상 — GREEN 단계(Step 5)에서 전부 복귀하는지 확인.

- [ ] **Step 4: 구현**

`src/infrastructure/lang/lang-file-parser.ts` 신규:

```ts
export interface ParsedLangString { key: string; value: string; line: number; }

/** Moodle lang 파일의 `$string['key'] = '값';` 항목 추출.
 *  단일 인용부호 관례만 지원(double-quoted·heredoc은 스펙 비목표), 여러 줄 값 허용. */
export function parseLangFile(text: string): ParsedLangString[] {
  const out: ParsedLangString[] = [];
  const re = /\$string\[\s*'((?:[^'\\]|\\.)+)'\s*\]\s*=\s*'((?:[^'\\]|\\.)*)'\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const line = text.slice(0, m.index).split('\n').length - 1;
    out.push({ key: unescapeSq(m[1]), value: unescapeSq(m[2]), line });
  }
  return out;
}

function unescapeSq(s: string): string { return s.replace(/\\(['\\])/g, '$1'); }
```

`src/infrastructure/workspace/moodle-root-resolver.ts` — 파일 끝에 추가:

```ts
export interface LangFileRef { file: string; component: string; locale: string; }
const LANG_LOCALES = ['en', 'ko'];

/** 코어(lang/en/*.php — ko 언어팩은 저장소 밖) + 플러그인(lang/{en,ko})의 lang 파일 열거.
 *  mod 플러그인만 파일명이 `<name>.php`, 그 외는 `<type>_<name>.php` (Moodle 규칙). */
export function listLangFiles(root: string): LangFileRef[] {
  const out: LangFileRef[] = [];
  const coreDir = path.join(root, 'lang', 'en');
  for (const f of safeReaddirFiles(coreDir)) {
    if (!f.endsWith('.php')) continue;
    const base = f.slice(0, -4);
    out.push({ file: path.join(coreDir, f), component: base === 'moodle' ? 'core' : `core_${base}`, locale: 'en' });
  }
  for (const type of PLUGIN_TYPES) {
    const typeDir = path.join(root, type);
    if (!fs.existsSync(typeDir)) continue;
    for (const name of safeReaddir(typeDir)) {
      const expected = type === 'mod' ? `${name}.php` : `${type}_${name}.php`;
      for (const locale of LANG_LOCALES) {
        const f = path.join(typeDir, name, 'lang', locale, expected);
        if (fs.existsSync(f)) out.push({ file: f, component: `${type}_${name}`, locale });
      }
    }
  }
  return out;
}

function safeReaddirFiles(dir: string): string[] {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile()).map(d => d.name); }
  catch { return []; }
}
```

- [ ] **Step 5: 테스트 통과 + 회귀 확인**

Run: `npx mocha test/unit/infra/lang-parser.test.ts test/unit/infra/resolver.test.ts && npm run test:unit && npx tsc -noEmit`
Expected: 신규 6건 포함 전부 녹색 — 84건(78 + 6). 기존 `install.xml 목록` 테스트가 픽스처 추가(mod/testmod에는 db/install.xml 없음)에 영향받지 않는지 확인.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/lang/lang-file-parser.ts src/infrastructure/workspace/moodle-root-resolver.ts test/fixtures/mini-moodle test/unit/infra/lang-parser.test.ts test/unit/infra/resolver.test.ts
git commit -m "feat(infra): lang 파일 파서 + 열거 — 코어/플러그인·en/ko·mod 파일명 규칙"
```

---

### Task 2: 도메인 모델 + StringIndexStore

**Files:**
- Create: `src/domain/lang-model/lang-string.ts`, `src/domain/lang-model/ports/string-repository.ts`
- Create: `src/infrastructure/lang/string-index-store.ts`
- Test: `test/unit/infra/string-index.test.ts`

**Interfaces:**
- Consumes: Task 1의 `parseLangFile`, `listLangFiles`. 기존 `SourceLocation`(`src/domain/shared/value-objects.ts`).
- Produces:
```ts
export interface LangEntry { value: string; location: SourceLocation; }
export interface LangString { key: string; ko?: LangEntry; en?: LangEntry; }
export interface StringRepository {
  getString(component: string, key: string): LangString | undefined;
  keysOf(component: string): LangString[];
  hasComponent(component: string): boolean;
}
```
`StringIndexStore implements StringRepository` + `buildFromRoot(root: string): void`. Task 4·5가 소비.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/unit/infra/string-index.test.ts` 신규 (mini-moodle 픽스처 사용):

```ts
import { strict as assert } from 'assert';
import { join } from 'path';
import { StringIndexStore } from '../../../src/infrastructure/lang/string-index-store';

const root = join(__dirname, '../../fixtures/mini-moodle');
const store = new StringIndexStore();
store.buildFromRoot(root); // 동기 — 모듈 로드 시 1회 (최상위 before()는 mocha 전역 루트 훅이 되므로 금지)

describe('StringIndexStore', () => {
  it('ko/en 병합: 같은 키에 두 locale', () => {
    const s = store.getString('local_ubattend', 'attendance_book')!;
    assert.equal(s.ko!.value, '출석부');
    assert.equal(s.en!.value, 'Attendance book');
    assert.ok(s.ko!.location.uri.endsWith('lang/ko/local_ubattend.php'));
  });
  it('en만 있는 키', () => {
    const s = store.getString('local_ubattend', 'attendance_rate')!;
    assert.equal(s.en!.value, 'Attendance rate');
    assert.equal(s.ko, undefined);
  });
  it("정규화: ''/'moodle'/'core' → 코어", () => {
    for (const c of ['', 'moodle', 'core']) assert.equal(store.getString(c, 'ok')!.en!.value, 'OK');
  });
  it('mod 컴포넌트 + 레거시 단축(bare) 해석', () => {
    assert.equal(store.getString('mod_testmod', 'pluginname')!.en!.value, 'Test module');
    assert.equal(store.getString('testmod', 'pluginname')!.en!.value, 'Test module'); // bare → mod_testmod
  });
  it('hasComponent: 색인된 것만 true', () => {
    assert.equal(store.hasComponent('local_ubattend'), true);
    assert.equal(store.hasComponent('local_nope'), false);
  });
  it('keysOf: 컴포넌트의 전체 키(병합 후)', () => {
    const keys = store.keysOf('local_ubattend').map(s => s.key).sort();
    assert.deepEqual(keys, ['attendance_book', 'attendance_rate']);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx mocha test/unit/infra/string-index.test.ts`
Expected: FAIL — 모듈 미존재.

- [ ] **Step 3: 구현**

`src/domain/lang-model/lang-string.ts`:
```ts
import { SourceLocation } from '../shared/value-objects';
export interface LangEntry { value: string; location: SourceLocation; }
export interface LangString { key: string; ko?: LangEntry; en?: LangEntry; }
```

`src/domain/lang-model/ports/string-repository.ts`:
```ts
import { LangString } from '../lang-string';
export interface StringRepository {
  getString(component: string, key: string): LangString | undefined;
  keysOf(component: string): LangString[];
  hasComponent(component: string): boolean;
}
```

`src/infrastructure/lang/string-index-store.ts`:
```ts
import * as fs from 'fs';
import { LangEntry, LangString } from '../../domain/lang-model/lang-string';
import { StringRepository } from '../../domain/lang-model/ports/string-repository';
import { parseLangFile } from './lang-file-parser';
import { listLangFiles } from '../workspace/moodle-root-resolver';

export class StringIndexStore implements StringRepository {
  private byComponent = new Map<string, Map<string, LangString>>();

  buildFromRoot(root: string): void {
    const map = new Map<string, Map<string, LangString>>();
    for (const { file, component, locale } of listLangFiles(root)) {
      let comp = map.get(component);
      if (!comp) { comp = new Map(); map.set(component, comp); }
      for (const p of safeParseLang(file)) {
        let entry = comp.get(p.key);
        if (!entry) { entry = { key: p.key }; comp.set(p.key, entry); }
        const e: LangEntry = { value: p.value, location: { uri: file, line: p.line, column: 0 } };
        if (locale === 'ko') entry.ko = e; else entry.en = e;
      }
    }
    this.byComponent = map;
  }

  getString(component: string, key: string): LangString | undefined {
    return this.byComponent.get(this.normalize(component))?.get(key);
  }
  keysOf(component: string): LangString[] {
    const c = this.byComponent.get(this.normalize(component));
    return c ? [...c.values()] : [];
  }
  hasComponent(component: string): boolean { return this.byComponent.has(this.normalize(component)); }

  /** raw component → canonical 색인 키. bare 이름은 코어 서브시스템 우선, 아니면 레거시 mod 단축. */
  private normalize(raw: string): string {
    const s = raw.trim();
    if (!s || s === 'moodle' || s === 'core') return 'core';
    if (s.includes('_')) return s;
    if (this.byComponent.has(`core_${s}`)) return `core_${s}`;
    return `mod_${s}`;
  }
}

function safeParseLang(file: string) {
  try { return parseLangFile(fs.readFileSync(file, 'utf8')); } catch { return []; }
}
```

- [ ] **Step 4: 테스트 통과 + 회귀 확인**

Run: `npx mocha test/unit/infra/string-index.test.ts && npm run test:unit && npx tsc -noEmit`
Expected: 신규 6건 포함 전부 녹색 — 90건(84 + 6).

- [ ] **Step 5: Commit**

```bash
git add src/domain/lang-model src/infrastructure/lang/string-index-store.ts test/unit/infra/string-index.test.ts
git commit -m "feat(infra): StringIndexStore — lang 색인 조립·ko/en 병합·컴포넌트 정규화"
```

---

### Task 3: stringCalls 팩트 추출

**Files:**
- Modify: `src/domain/code-analysis/facts.ts`
- Modify: `src/infrastructure/tree-sitter/tree-sitter-php-syntax.ts`
- Modify: `test/unit/domain/inference.test.ts:6` (base에 `stringCalls: []` 추가), `test/unit/infra/cached-php-syntax.test.ts` (CountingFake 반환 리터럴에 `stringCalls: []` 추가) — 컴파일 유지용
- Test: `test/unit/infra/tree-sitter.test.ts`

**Interfaces:**
- Consumes: 기존 어댑터 헬퍼(`runMatches`).
- Produces:
```ts
export interface StringCall {
  key: string; component: string;
  keyLine: number; keyColumn: number; keyIndex: number;
  index: number;
}
```
`DocumentFacts.stringCalls: StringCall[]` (필수, **scope 없음** — scopeContaining 타입 가드가 제외). Task 4가 소비.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/unit/infra/tree-sitter.test.ts` 파일 끝에 추가:

```ts
// Plan 2: get_string 리터럴 호출 추출 (스펙 2026-08-04)
const CODE5 = `<?php
function s() {
    $t = get_string('attendance_book', 'local_ubattend');
    $u = get_string('attemptnum', 'local_ubattend', $count);
    $v = get_string($dynamic, 'local_ubattend');
    $w = other_string('not_me', 'local_ubattend');
}
`;

describe('TreeSitterPhpSyntax — stringCalls (get_string)', () => {
  let syn: TreeSitterPhpSyntax; let f: any;
  before(async () => { syn = await TreeSitterPhpSyntax.create(); f = syn.facts(CODE5); });

  it('리터럴 key/component 추출 + key 위치 정확성', () => {
    const c = f.stringCalls.find((x: any) => x.key === 'attendance_book');
    assert.ok(c, 'attendance_book 호출이 추출되어야 함');
    assert.equal(c.component, 'local_ubattend');
    assert.equal(CODE5.slice(c.keyIndex, c.keyIndex + c.key.length), 'attendance_book');
    assert.ok(c.keyLine === 2 && c.keyColumn > 0);
  });
  it('3번째 인자($a)가 있어도 추출', () => {
    assert.ok(f.stringCalls.some((x: any) => x.key === 'attemptnum'));
  });
  it('변수 키는 비추출(자연 침묵)', () => {
    assert.equal(f.stringCalls.filter((x: any) => x.component === 'local_ubattend').length, 2);
  });
  it('get_string 아닌 함수는 제외', () => {
    assert.ok(!f.stringCalls.some((x: any) => x.key === 'not_me'));
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx mocha test/unit/infra/tree-sitter.test.ts`
Expected: 신규 4건 FAIL — `f.stringCalls` undefined(런타임, `f`는 any). 기존은 통과.

- [ ] **Step 3: 팩트 스키마 확장**

`src/domain/code-analysis/facts.ts` — `PlainAssignment` 다음에 추가:
```ts
export interface StringCall {
  key: string; component: string;
  keyLine: number; keyColumn: number; keyIndex: number;
  index: number;
}
```
`DocumentFacts`에 `stringCalls: StringCall[];` 추가.

컴파일 유지(테스트 로직 무변경):
- `test/unit/domain/inference.test.ts:6` base에 `stringCalls: []` 추가.
- `test/unit/infra/cached-php-syntax.test.ts`의 `CountingFake.facts()` 반환 리터럴에 `stringCalls: []` 추가.

- [ ] **Step 4: 어댑터 쿼리 + 추출**

`src/infrastructure/tree-sitter/tree-sitter-php-syntax.ts`:

1. import에 `StringCall` 추가(기존 facts import 나열에).
2. `Q_PLAIN_ASSIGN` 아래에 추가:
```ts
// Plan 2: get_string('key','component') 리터럴 호출 — 함수명 필터는 캡처 후 코드에서(술어 미지원, Q_DATAARG 선례).
// 변수 키/컴포넌트·보간 문자열은 string_content 캡처가 없어 매칭 자체가 안 된다(자연 침묵).
const Q_STRING_CALL = `
  (function_call_expression
    function: (name) @fn
    arguments: (arguments
      . (argument (string (string_content) @key))
      . (argument (string (string_content) @component))))`;
```
3. `CompiledQueries`에 `stringCall: Parser.Query;`, `create()`에 `stringCall: lang.query(Q_STRING_CALL),` 추가.
4. `facts()`의 `plainAssignments` 블록 다음에:
```ts
const stringCalls: StringCall[] = [];
for (const { caps } of runMatches(this.queries.stringCall)) {
  const fn = caps.get('fn')!;
  if (fn.text !== 'get_string') continue;
  const key = caps.get('key')!, component = caps.get('component')!;
  stringCalls.push({
    key: key.text, component: component.text,
    keyLine: key.startPosition.row, keyColumn: key.startPosition.column, keyIndex: key.startIndex,
    index: fn.startIndex,
  });
}
```
5. 반환 객체에 `stringCalls` 추가.

- [ ] **Step 5: 테스트 통과 + 회귀 확인**

Run: `npx mocha test/unit/infra/tree-sitter.test.ts && npm run test:unit && npx tsc -noEmit && npx tsc -p tsconfig.test.json`
Expected: 신규 4건 포함 전부 녹색 — 94건(90 + 4). 기존 완성 테스트(클로저 정밀화)가 녹색 = scope 없는 StringCall이 scopeContaining에서 안전히 제외됨을 실증.

- [ ] **Step 6: Commit**

```bash
git add src/domain/code-analysis/facts.ts src/infrastructure/tree-sitter/tree-sitter-php-syntax.ts test/unit/infra/tree-sitter.test.ts test/unit/domain/inference.test.ts test/unit/infra/cached-php-syntax.test.ts
git commit -m "feat(infra): stringCalls 팩트 — get_string 리터럴 호출 추출"
```

---

### Task 4: 유즈케이스 4개 + closestKey

**Files:**
- Create: `src/domain/lang-model/services/string-validator.ts`
- Create: `src/application/string-call-lookup.ts`, `src/application/complete-string-keys.ts`, `src/application/resolve-string-definition.ts`, `src/application/describe-string.ts`, `src/application/validate-string-keys.ts`
- Modify: `src/application/dto.ts` (`StringItem` 추가)
- Test: `test/unit/domain/string-validator.test.ts`, `test/unit/application/string-usecases.test.ts`

**Interfaces:**
- Consumes: Task 2 `StringRepository`/`LangString`, Task 3 `DocumentFacts.stringCalls`/`StringCall`, 기존 `PhpSyntax`·`DefinitionResult`·`HoverResult`·`DiagnosticItem`·`levenshtein`.
- Produces (Task 5가 소비):
```ts
export interface StringItem { key: string; ko?: string; en?: string; }
CompleteStringKeys.run(component: string): StringItem[]
ResolveStringDefinition.run(text: string, atIndex: number): DefinitionResult[]
DescribeString.run(text: string, atIndex: number): HoverResult | null
ValidateStringKeys.run(text: string): DiagnosticItem[]
```

- [ ] **Step 1: 실패하는 테스트 작성**

`test/unit/domain/string-validator.test.ts` 신규:
```ts
import { strict as assert } from 'assert';
import { closestKey } from '../../../src/domain/lang-model/services/string-validator';

describe('closestKey', () => {
  it('편집거리 최소 키 제안', () =>
    assert.equal(closestKey(['attendance_book', 'attendance_rate'], 'attendance_bok'), 'attendance_book'));
  it('거리 초과 시 undefined', () =>
    assert.equal(closestKey(['attendance_book'], 'zzzz'), undefined));
});
```

`test/unit/application/string-usecases.test.ts` 신규 (실파서 + mini-moodle 실색인 E2E):
```ts
import { strict as assert } from 'assert';
import { join } from 'path';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/tree-sitter/tree-sitter-php-syntax';
import { StringIndexStore } from '../../../src/infrastructure/lang/string-index-store';
import { CompleteStringKeys } from '../../../src/application/complete-string-keys';
import { ResolveStringDefinition } from '../../../src/application/resolve-string-definition';
import { DescribeString } from '../../../src/application/describe-string';
import { ValidateStringKeys } from '../../../src/application/validate-string-keys';

const root = join(__dirname, '../../fixtures/mini-moodle');
const store = new StringIndexStore();
store.buildFromRoot(root); // 동기 — 모듈 로드 시 1회

const CODE = `<?php
function s() {
  echo get_string('attendance_book', 'local_ubattend');
  echo get_string('attendance_bok', 'local_ubattend');
  echo get_string('anything', 'local_unknown');
}
`;

describe('언어 문자열 유즈케이스 (E2E)', () => {
  it('완성: 키 + ko/en 값', () => {
    const items = new CompleteStringKeys(store).run('local_ubattend');
    const book = items.find(i => i.key === 'attendance_book')!;
    assert.equal(book.ko, '출석부');
    assert.equal(book.en, 'Attendance book');
    assert.equal(items.length, 2);
  });
  it('정의로 이동: ko·en 두 위치(커서가 key 안)', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const at = CODE.indexOf('attendance_book') + 3;
    const locs = new ResolveStringDefinition(syn, store).run(CODE, at);
    assert.equal(locs.length, 2);
    assert.ok(locs.some(l => l.location.uri.endsWith('lang/ko/local_ubattend.php')));
    assert.ok(locs.some(l => l.location.uri.endsWith('lang/en/local_ubattend.php')));
  });
  it('hover: 한국어 값 + 영어 값', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const at = CODE.indexOf('attendance_book') + 3;
    const r = new DescribeString(syn, store).run(CODE, at)!;
    assert.match(r.markdown, /출석부/);
    assert.match(r.markdown, /Attendance book/);
  });
  it('진단: 누락 키만 경고 + 가장 가까운 키 제안, 미색인 컴포넌트는 침묵', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const diags = new ValidateStringKeys(syn, store).run(CODE);
    assert.equal(diags.length, 1);
    assert.match(diags[0].message, /attendance_bok/);
    assert.equal(diags[0].suggestion, 'attendance_book');
    assert.equal(diags[0].length, 'attendance_bok'.length);
  });
  it('hover/정의: 커서가 key 밖(component 위)이면 null/[]', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const at = CODE.indexOf("'local_ubattend'") + 3;
    assert.equal(new DescribeString(syn, store).run(CODE, at), null);
    assert.deepEqual(new ResolveStringDefinition(syn, store).run(CODE, at), []);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx mocha test/unit/domain/string-validator.test.ts test/unit/application/string-usecases.test.ts`
Expected: FAIL — 모듈 미존재.

- [ ] **Step 3: 구현**

`src/domain/lang-model/services/string-validator.ts` (closestColumn과 대칭):
```ts
import { levenshtein } from '../../shared/value-objects';

export function closestKey(keys: string[], key: string, maxDistance = 3): string | undefined {
  let best: string | undefined; let bestD = maxDistance + 1;
  for (const k of keys) {
    const d = levenshtein(key, k);
    if (d < bestD) { bestD = d; best = k; }
  }
  return bestD <= maxDistance ? best : undefined;
}
```

`src/application/dto.ts`에 추가:
```ts
export interface StringItem { key: string; ko?: string; en?: string; }
```

`src/application/string-call-lookup.ts` (resolve/describe 공용 — record 쌍의 중복(백로그 8번)을 반복하지 않기 위한 헬퍼):
```ts
import { DocumentFacts, StringCall } from '../domain/code-analysis/facts';

/** 커서가 get_string의 key 리터럴 내용 범위 안에 있는 호출 */
export function findStringCallAt(facts: DocumentFacts, atIndex: number): StringCall | undefined {
  return facts.stringCalls.find(c => c.keyIndex <= atIndex && atIndex <= c.keyIndex + c.key.length);
}
```

`src/application/complete-string-keys.ts`:
```ts
import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { StringItem } from './dto';

export class CompleteStringKeys {
  constructor(private strings: StringRepository) {}
  run(component: string): StringItem[] {
    return this.strings.keysOf(component).map(s => ({ key: s.key, ko: s.ko?.value, en: s.en?.value }));
  }
}
```

`src/application/resolve-string-definition.ts`:
```ts
import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { DefinitionResult } from './dto';
import { findStringCallAt } from './string-call-lookup';

export class ResolveStringDefinition {
  constructor(private syntax: PhpSyntax, private strings: StringRepository) {}
  run(text: string, atIndex: number): DefinitionResult[] {
    const call = findStringCallAt(this.syntax.facts(text), atIndex);
    if (!call) return [];
    const s = this.strings.getString(call.component, call.key);
    if (!s) return [];
    const out: DefinitionResult[] = [];
    if (s.ko) out.push({ location: s.ko.location });
    if (s.en) out.push({ location: s.en.location });
    return out;
  }
}
```

`src/application/describe-string.ts`:
```ts
import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { HoverResult } from './dto';
import { findStringCallAt } from './string-call-lookup';

export class DescribeString {
  constructor(private syntax: PhpSyntax, private strings: StringRepository) {}
  run(text: string, atIndex: number): HoverResult | null {
    const call = findStringCallAt(this.syntax.facts(text), atIndex);
    if (!call) return null;
    const s = this.strings.getString(call.component, call.key);
    if (!s) return null;
    const parts = [`**${call.component} / ${call.key}**`];
    if (s.ko) parts.push(`ko: ${s.ko.value}`);
    if (s.en) parts.push(`en: ${s.en.value}`);
    return { markdown: parts.join('\n\n') };
  }
}
```

`src/application/validate-string-keys.ts`:
```ts
import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { closestKey } from '../domain/lang-model/services/string-validator';
import { DiagnosticItem } from './dto';

export class ValidateStringKeys {
  constructor(private syntax: PhpSyntax, private strings: StringRepository) {}
  run(text: string): DiagnosticItem[] {
    const out: DiagnosticItem[] = [];
    for (const c of this.syntax.facts(text).stringCalls) {
      if (!this.strings.hasComponent(c.component)) continue; // 미색인 컴포넌트는 침묵(오탐 방지)
      if (this.strings.getString(c.component, c.key)) continue;
      out.push({
        line: c.keyLine, column0: c.keyColumn, length: c.key.length,
        message: `'${c.component}'에 '${c.key}' 문자열이 없습니다.`,
        suggestion: closestKey(this.strings.keysOf(c.component).map(s => s.key), c.key),
      });
    }
    return out;
  }
}
```

- [ ] **Step 4: 테스트 통과 + 회귀 확인**

Run: `npx mocha test/unit/domain/string-validator.test.ts test/unit/application/string-usecases.test.ts && npm run test:unit && npx tsc -noEmit`
Expected: 신규 8건 포함 전부 녹색 — 102건(94 + 8).

- [ ] **Step 5: Commit**

```bash
git add src/domain/lang-model/services/string-validator.ts src/application test/unit/domain/string-validator.test.ts test/unit/application/string-usecases.test.ts
git commit -m "feat(app): 언어 문자열 유즈케이스 4개 — 완성/정의/hover/누락 진단"
```

---

### Task 5: 프로바이더 + 결선

**Files:**
- Create: `src/presentation/providers/string-key-completion-provider.ts`, `src/presentation/providers/string-definition-provider.ts`, `src/presentation/providers/string-hover-provider.ts`
- Modify: `src/presentation/providers/record-diagnostics.ts` (문자열 검증 합류), `src/extension.ts` (색인·유즈케이스·프로바이더·watcher 결선)

**Interfaces:**
- Consumes: Task 4 유즈케이스 4개, Task 2 `StringIndexStore`, 기존 `toVscodeLocation`·`registerDiagnostics` 패턴.
- Produces: 사용자 기능 결선 완료. 유닛 테스트 없음(vscode 결선 — 기존 관례) — `tsc`/lint/기존 테스트로 검증, 수동 검증은 Task 6 문서.

- [ ] **Step 1: 프로바이더 3개 생성**

`src/presentation/providers/string-key-completion-provider.ts`:
```ts
import * as vscode from 'vscode';
import { CompleteStringKeys } from '../../application/complete-string-keys';

export class StringKeyCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private uc: CompleteStringKeys) {}
  provideCompletionItems(doc: vscode.TextDocument, pos: vscode.Position): vscode.CompletionItem[] {
    const line = doc.lineAt(pos.line).text;
    const before = line.slice(0, pos.character);
    if (!/get_string\(\s*['"][\w:.\/-]*$/.test(before)) return [];
    // component는 커서 뒤에서 추출 — 아직 입력 전이면 완성 불가(키 목록을 알 수 없음)
    const cm = line.slice(pos.character).match(/^[\w:.\/-]*['"]\s*,\s*['"](\w+)['"]/);
    if (!cm) return [];
    return this.uc.run(cm[1]).map(s => {
      const it = new vscode.CompletionItem(s.key, vscode.CompletionItemKind.Text);
      it.detail = s.ko ?? s.en ?? '';
      if (s.ko && s.en) it.documentation = new vscode.MarkdownString(`en: ${s.en}`);
      return it;
    });
  }
}
```

`src/presentation/providers/string-definition-provider.ts`:
```ts
import * as vscode from 'vscode';
import { ResolveStringDefinition } from '../../application/resolve-string-definition';
import { toVscodeLocation } from '../mappers';

export class StringDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private uc: ResolveStringDefinition) {}
  provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): vscode.Location[] {
    return this.uc.run(doc.getText(), doc.offsetAt(pos)).map(r => toVscodeLocation(r.location));
  }
}
```

`src/presentation/providers/string-hover-provider.ts`:
```ts
import * as vscode from 'vscode';
import { DescribeString } from '../../application/describe-string';

export class StringHoverProvider implements vscode.HoverProvider {
  constructor(private uc: DescribeString) {}
  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | null {
    const r = this.uc.run(doc.getText(), doc.offsetAt(pos));
    return r ? new vscode.Hover(new vscode.MarkdownString(r.markdown)) : null;
  }
}
```

- [ ] **Step 2: 진단 합류**

`src/presentation/providers/record-diagnostics.ts`:
1. import 추가: `import { ValidateStringKeys } from '../../application/validate-string-keys';`
2. 시그니처 변경: `export function registerDiagnostics(ctx: vscode.ExtensionContext, uc: ValidateRecordColumns, ucStrings: ValidateStringKeys) {`
3. `refresh` 안의 `const items = uc.run(doc.getText());`를 다음으로 교체:
```ts
    const text = doc.getText();
    const items = [...uc.run(text), ...ucStrings.run(text)];
```
(나머지 — debounce·가드·매핑 — 무변경. 두 유즈케이스가 같은 텍스트를 파싱해도 CachedPhpSyntax 히트라 재파싱 없음.)

- [ ] **Step 3: extension.ts 결선**

`src/extension.ts`:
1. import 추가:
```ts
import { StringIndexStore } from './infrastructure/lang/string-index-store';
import { CompleteStringKeys } from './application/complete-string-keys';
import { ResolveStringDefinition } from './application/resolve-string-definition';
import { DescribeString } from './application/describe-string';
import { ValidateStringKeys } from './application/validate-string-keys';
import { StringKeyCompletionProvider } from './presentation/providers/string-key-completion-provider';
import { StringDefinitionProvider } from './presentation/providers/string-definition-provider';
import { StringHoverProvider } from './presentation/providers/string-hover-provider';
```
2. `store.buildFromRoot(root);` 다음에:
```ts
  const strings = new StringIndexStore();
  strings.buildFromRoot(root);
```
3. 기존 유즈케이스 4개 생성부 다음에:
```ts
  const completeStr = new CompleteStringKeys(strings);
  const resolveStr = new ResolveStringDefinition(syntax, strings);
  const describeStr = new DescribeString(syntax, strings);
  const validateStr = new ValidateStringKeys(syntax, strings);
```
4. 프로바이더 등록 블록(`ctx.subscriptions.push(...)`)에 세 줄 추가:
```ts
    vscode.languages.registerCompletionItemProvider(php, new StringKeyCompletionProvider(completeStr), "'", '"'),
    vscode.languages.registerDefinitionProvider(php, new StringDefinitionProvider(resolveStr)),
    vscode.languages.registerHoverProvider(php, new StringHoverProvider(describeStr)),
```
5. `registerDiagnostics(ctx, validate);` → `registerDiagnostics(ctx, validate, validateStr);`
6. install.xml watcher 다음에 lang watcher 추가:
```ts
  // lang 파일 변경 시 문자열 전체 재색인(단순화 — install.xml 워처와 동일 패턴)
  const langWatcher = vscode.workspace.createFileSystemWatcher('**/lang/*/*.php');
  const restring = () => strings.buildFromRoot(root);
  ctx.subscriptions.push(langWatcher, langWatcher.onDidChange(restring), langWatcher.onDidCreate(restring), langWatcher.onDidDelete(restring));
```

- [ ] **Step 4: 검증**

Run: `npm run test:unit && npm run lint && npm run compile && npx tsc -p tsconfig.test.json`
Expected: 전부 통과 — 102건, lint(레이어 규칙 포함), 번들, 테스트 컴파일.

- [ ] **Step 5: Commit**

```bash
git add src/presentation src/extension.ts
git commit -m "feat(presentation): 문자열 프로바이더 3개 + 진단 합류 + lang watcher 결선"
```

---

### Task 6: 문서 갱신 + 최종 검증

**Files:**
- Modify: `docs/PHASE2-BACKLOG.md`, `docs/manual-verification.md`, `README.md`

**Interfaces:**
- Consumes: Task 1~5 완료 상태 (코드 변경 없음).
- Produces: 갱신된 문서.

- [ ] **Step 1: 백로그 갱신**

`docs/PHASE2-BACKLOG.md`:

(a) "## Plan 2 (별도 계획 예정)" 섹션의 `- **언어 문자열 인텔리전스**: …` 불릿을 다음으로 교체:
```markdown
- ~~**언어 문자열 인텔리전스**~~ — ✅ 완료 (2026-08-04, 설계: `docs/superpowers/specs/2026-08-04-lang-string-intelligence-design.md`). get_string 키 완성/정의 이동(ko·en)/hover(한국어 값)/누락 진단. 비목표: get_strings·lang_string·addHelpButton·AMD str, double-quoted/heredoc lang 값, component 이름 완성.
```

(b) 5번 항목의 문구를 다음으로 교체(비동기화 범위에 문자열 색인 포함):
```markdown
5. **비동기 활성화 색인**: `buildFromRoot`(테이블·**문자열 색인 둘 다**)가 동기 `readFileSync`. 스펙 §6의 비동기·프로그레스로. `safeReaddir`의 statSync도 함께 비동기화(2026-08-04 최종 리뷰 메모).
```

- [ ] **Step 2: 수동 검증 체크리스트 추가**

`docs/manual-verification.md`의 7번 항목 다음에 추가:
```markdown
8. get_string('', 'local_ubattend')의 첫 인자 따옴표 안에서 입력 → 키 목록 + 한국어 값 미리보기
9. 존재하는 키 위에서 F12 → lang/ko·lang/en 파일의 $string 줄로 이동(둘 다 있으면 피커), hover → 한국어+영어 값
10. 존재하지 않는 키(예: get_string('attendance_bok', 'local_ubattend')) → 경고 + 가까운 키 제안. 색인에 없는 컴포넌트는 경고 없음 확인
```

- [ ] **Step 3: README 기능 추가**

`README.md`의 기능 목록(DB 레코드 기능 나열부) 다음에 추가:
```markdown
- **언어 문자열 인텔리전스**: `get_string('key', 'component')` 키 자동완성(한국어 값 미리보기)·정의로 이동(ko/en)·hover·누락 키 진단
```
(README의 기존 형식에 맞춰 해당 목록 끝에 삽입 — 형식이 다르면 기존 스타일을 따른다.)

- [ ] **Step 4: 최종 전체 검증**

Run: `npm run test:unit && npm run lint && npm run compile && npx tsc -p tsconfig.test.json`
Expected: 전부 통과 — 유닛 102건(78 기존 + 24 신규), eslint, 번들, 테스트 컴파일.

- [ ] **Step 5: Commit**

```bash
git add docs/PHASE2-BACKLOG.md docs/manual-verification.md README.md
git commit -m "docs: Plan 2 완료 반영 — 문자열 기능 문서화, 백로그 갱신"
```
