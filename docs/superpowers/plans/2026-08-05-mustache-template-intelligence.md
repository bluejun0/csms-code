# Mustache 템플릿 인텔리전스 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `render_from_template('component/name', …)`에서 `.mustache` 파일로 정의 이동, `.mustache` 파일에서 사용처 참조 이동, 해석되는 템플릿 참조 하이라이팅. 더불어 플러그인 타입→디렉터리 매핑 오류(block 등 20개 타입 미색인)를 바로잡는다.

**Architecture:** `PLUGIN_TYPES`(타입명=디렉터리명 가정)를 실측 검증된 `PLUGIN_DIRS` 매핑으로 교체해 열거 3곳이 공유한다. `TemplateIndex`가 `**/templates/**/*.mustache`를 스캔해 경로에서 `component/name`을 역산(테마 오버라이드는 같은 키에 복수 위치). `templateCalls` 팩트가 리터럴 호출을 잡고, 기존 사용처 스캔(`StringUsageIndex`→`PhpUsageIndex`)에 템플릿 정규식을 합쳐 **한 번의 스캔이 두 색인을 채운다**.

**Tech Stack:** TypeScript (strict), web-tree-sitter, mocha + ts-node.

**Spec:** `docs/superpowers/specs/2026-08-05-mustache-template-intelligence-design.md`

## Global Constraints

- **사용처 스캔은 절대 두 번 돌리지 않는다** — 템플릿 참조는 기존 `PhpUsageIndex` 스캔 루프에 정규식을 추가해 함께 수집한다.
- `TemplateCall` 팩트는 **scope 필드 없음**(`scopeContaining`의 `'scope' in x` 가드가 제외). `DocumentFacts.templateCalls`는 필수 필드 — 생성처 3곳(어댑터 반환, `inference.test.ts` base, `cached-php-syntax.test.ts` CountingFake) 모두 갱신해야 컴파일된다.
- 프로바이더는 vscode + application(+주입 인터페이스)만 import — infrastructure 직접 import 금지.
- tree-sitter 쿼리는 인스턴스당 1회 컴파일(`create()`), 메서드명 필터는 캡처 후 코드에서(Q_DATAARG 선례).
- 침묵 원칙: 동적 인자·규칙 밖 경로·`/` 없는 ref는 빈 결과. 오탐 금지.
- 유닛: `npm run test:unit`. 개별: `npx mocha test/unit/<path>.test.ts`. 커밋: `feat|fix|docs(scope): 한국어 요약`.

---

### Task 1: PLUGIN_DIRS 매핑 — 플러그인 20개 타입 색인 복구

**Files:**
- Modify: `src/infrastructure/workspace/moodle-root-resolver.ts`
- Create: `test/fixtures/mini-moodle/blocks/testblock/db/install.xml`, `test/fixtures/mini-moodle/blocks/testblock/lang/en/block_testblock.php`, `test/fixtures/mini-moodle/admin/tool/testtool/lang/en/tool_testtool.php`
- Test: `test/unit/infra/resolver.test.ts`

**Interfaces:**
- Consumes: 기존 `safeReaddir`·`safeReaddirFiles`·`LANG_LOCALES`.
- Produces: `PLUGIN_DIRS: Record<string, string>`(export — Task 2가 소비), `pluginTypeOfRel(rel: string): { type: string; name: string; rest: string } | null`(export — 최장일치 역산 헬퍼, Task 2가 소비). `listInstallXmlFiles`·`listLangFiles`·`componentOfLangFile` 시그니처 무변경.

- [ ] **Step 1: 픽스처 생성**

`test/fixtures/mini-moodle/blocks/testblock/db/install.xml`:
```xml
<?xml version="1.0" encoding="UTF-8" ?>
<XMLDB PATH="blocks/testblock/db" VERSION="20260805">
  <TABLES>
    <TABLE NAME="block_testblock" COMMENT="블록 테스트 테이블">
      <FIELDS>
        <FIELD NAME="id" TYPE="int" LENGTH="10" NOTNULL="true" SEQUENCE="true" COMMENT="고유번호"/>
      </FIELDS>
    </TABLE>
  </TABLES>
</XMLDB>
```

`test/fixtures/mini-moodle/blocks/testblock/lang/en/block_testblock.php`:
```php
<?php
$string['pluginname'] = 'Test block';
```

`test/fixtures/mini-moodle/admin/tool/testtool/lang/en/tool_testtool.php`:
```php
<?php
$string['pluginname'] = 'Test tool';
```

- [ ] **Step 2: 실패하는 테스트 작성**

`test/unit/infra/resolver.test.ts` — 기존 두 테스트의 기대값을 갱신하고(신규 픽스처 반영) 역산 테스트를 추가한다.

기존 `'install.xml 목록 + 컴포넌트명'` 테스트의 단언을 다음으로 교체:
```ts
    assert.deepEqual(list, ['block_testblock', 'core', 'local_ubattend']);
```

기존 `'코어(en)·플러그인(en/ko)·mod 파일명 예외를 컴포넌트·locale과 함께 열거'` 테스트의 단언을 다음으로 교체:
```ts
    assert.deepEqual(list, ['block_testblock:en', 'core:en', 'core_grades:en', 'local_ubattend:en', 'local_ubattend:ko', 'mod_testmod:en', 'tool_testtool:en']);
```

`componentOfLangFile` describe에 추가:
```ts
  it('blocks 디렉터리(타입명 block)도 역산', () =>
    assert.equal(componentOfLangFile(root, join(root, 'blocks/testblock/lang/en/block_testblock.php')), 'block_testblock'));
  it('중첩 디렉터리(admin/tool)도 역산', () =>
    assert.equal(componentOfLangFile(root, join(root, 'admin/tool/testtool/lang/en/tool_testtool.php')), 'tool_testtool'));
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx mocha test/unit/infra/resolver.test.ts`
Expected: FAIL 4건 — 열거 2건은 `block_testblock`·`tool_testtool` 누락(현재 `root/block/`·`root/tool/`을 찾으므로 실재하지 않음), 역산 2건은 `null` 반환.

- [ ] **Step 4: 구현**

`src/infrastructure/workspace/moodle-root-resolver.ts` — 4행의 `PLUGIN_TYPES` 상수를 다음으로 교체:

```ts
/** 플러그인 타입 → 루트 기준 상대 디렉터리. 타입명과 디렉터리명이 다르거나(block→blocks)
 *  중첩된(tool→admin/tool) 경우가 많아 매핑이 필요하다 — 2026-08-05 hlulxp 실측 검증. */
export const PLUGIN_DIRS: Record<string, string> = {
  mod: 'mod', local: 'local', block: 'blocks', report: 'report', enrol: 'enrol',
  auth: 'auth', theme: 'theme', filter: 'filter', repository: 'repository',
  portfolio: 'portfolio', webservice: 'webservice',
  tool: 'admin/tool', format: 'course/format', qtype: 'question/type',
  gradereport: 'grade/report', gradeexport: 'grade/export', gradeimport: 'grade/import',
  message: 'message/output', availability: 'availability/condition',
  customfield: 'customfield/field', contenttype: 'contentbank/contenttype',
  profilefield: 'user/profile/field', datafield: 'mod/data/field', datapreset: 'mod/data/preset',
  cachestore: 'cache/stores', cachelock: 'cache/locks',
  editor: 'lib/editor', atto: 'lib/editor/atto/plugins', tinymce: 'lib/editor/tinymce/plugins',
  mlbackend: 'lib/mlbackend',
};
```

`listInstallXmlFiles`의 루프(31-38행)를 다음으로 교체:
```ts
  for (const [type, relDir] of Object.entries(PLUGIN_DIRS)) {
    const typeDir = path.join(root, relDir);
    if (!fs.existsSync(typeDir)) continue;
    for (const name of safeReaddir(typeDir)) {
      const f = path.join(typeDir, name, 'db', 'install.xml');
      if (fs.existsSync(f)) out.push({ file: f, component: `${type}_${name}` });
    }
  }
```

`listLangFiles`의 루프(69-79행)를 다음으로 교체:
```ts
  for (const [type, relDir] of Object.entries(PLUGIN_DIRS)) {
    const typeDir = path.join(root, relDir);
    if (!fs.existsSync(typeDir)) continue;
    for (const name of safeReaddir(typeDir)) {
      const expected = type === 'mod' ? `${name}.php` : `${type}_${name}.php`;
      for (const locale of LANG_LOCALES) {
        const f = path.join(typeDir, name, 'lang', locale, expected);
        if (fs.existsSync(f)) out.push({ file: f, component: `${type}_${name}`, locale });
      }
    }
  }
```

`componentOfLangFile`(88-104행) 전체를 다음으로 교체하고, 그 앞에 공용 역산 헬퍼를 추가:
```ts
/** 루트 기준 상대경로에서 플러그인 타입·이름·나머지를 역산 — 다중 세그먼트 디렉터리 대응,
 *  최장 relDir 우선(예: `mod/data/field/x/…`는 datafield이지 mod가 아님). 규칙 밖은 null. */
export function pluginTypeOfRel(rel: string): { type: string; name: string; rest: string } | null {
  const parts = rel.split(path.sep);
  let best: { type: string; name: string; rest: string; depth: number } | null = null;
  for (const [type, relDir] of Object.entries(PLUGIN_DIRS)) {
    const dirParts = relDir.split('/');
    if (parts.length < dirParts.length + 2) continue;
    if (!dirParts.every((seg, i) => parts[i] === seg)) continue;
    const depth = dirParts.length;
    if (best && best.depth >= depth) continue;
    best = { type, name: parts[depth], rest: parts.slice(depth + 1).join('/'), depth };
  }
  return best ? { type: best.type, name: best.name, rest: best.rest } : null;
}

/** lang 파일 경로 → component (listLangFiles 규칙의 역함수 — 순수 경로 로직). 규칙 밖은 null. */
export function componentOfLangFile(root: string, file: string): string | null {
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (parts.length === 3 && parts[0] === 'lang' && parts[1] === 'en' && parts[2].endsWith('.php')) {
    const base = parts[2].slice(0, -4);
    return base === 'moodle' ? 'core' : `core_${base}`;
  }
  const hit = pluginTypeOfRel(rel);
  if (!hit) return null;
  const restParts = hit.rest.split('/');
  if (restParts.length !== 3 || restParts[0] !== 'lang' || !LANG_LOCALES.includes(restParts[1])) return null;
  const expected = hit.type === 'mod' ? `${hit.name}.php` : `${hit.type}_${hit.name}.php`;
  return restParts[2] === expected ? `${hit.type}_${hit.name}` : null;
}
```

- [ ] **Step 5: 테스트 통과 + 회귀 확인**

Run: `npx mocha test/unit/infra/resolver.test.ts && npm run test:unit && npx tsc -noEmit`
Expected: 신규 2건 + 갱신 2건 포함 전부 녹색 — 130건(128+2). `string-index.test.ts`(lang 색인)가 새 픽스처 컴포넌트 추가에도 기존 단언을 유지하는지 확인(단언들이 `local_ubattend`/`core`/`mod_testmod` 특정이라 영향 없어야 함).

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/workspace/moodle-root-resolver.ts test/fixtures/mini-moodle/blocks test/fixtures/mini-moodle/admin test/unit/infra/resolver.test.ts
git commit -m "fix(infra): 플러그인 타입→디렉터리 매핑 — block(blocks)·중첩 타입 20종 색인 복구"
```

---

### Task 2: TemplateIndex + 경로 역산

**Files:**
- Create: `src/domain/template-model/template-ref.ts`, `src/domain/template-model/ports/template-repository.ts`, `src/infrastructure/templates/template-index.ts`
- Modify: `src/infrastructure/workspace/moodle-root-resolver.ts` (`listTemplateFiles`·`componentOfTemplateFile` 추가)
- Create: 픽스처 `test/fixtures/mini-moodle/lib/templates/core_tmpl.mustache`, `local/ubattend/templates/setting.mustache`, `local/ubattend/templates/svg/icon/hyflex.mustache`, `theme/coursemos/templates/local_ubattend/setting.mustache`, `theme/coursemos/templates/own.mustache`, `grade/templates/ignored.mustache` (모두 mini-moodle 하위)
- Test: `test/unit/infra/template-index.test.ts`

**Interfaces:**
- Consumes: Task 1 `PLUGIN_DIRS`·`pluginTypeOfRel`, 기존 `SourceLocation`.
- Produces:
```ts
export interface TemplateRef { component: string; name: string; }
export interface TemplateRepository {
  locationsOf(component: string, name: string): SourceLocation[];
  has(component: string, name: string): boolean;
}
export class TemplateIndex implements TemplateRepository { buildFromRoot(root: string): void; }
export function componentOfTemplateFile(root: string, file: string): TemplateRef | null; // resolver
```
Task 5·6이 소비.

- [ ] **Step 1: 픽스처 6개 생성**

각 파일 내용은 아래와 같다(내용은 색인에 영향 없으나 식별을 위해 다르게 둔다).
- `test/fixtures/mini-moodle/lib/templates/core_tmpl.mustache` → `<div>core</div>`
- `test/fixtures/mini-moodle/local/ubattend/templates/setting.mustache` → `<div>setting</div>`
- `test/fixtures/mini-moodle/local/ubattend/templates/svg/icon/hyflex.mustache` → `<svg>hyflex</svg>`
- `test/fixtures/mini-moodle/theme/coursemos/templates/local_ubattend/setting.mustache` → `<div>override</div>`
- `test/fixtures/mini-moodle/theme/coursemos/templates/own.mustache` → `<div>theme own</div>`
- `test/fixtures/mini-moodle/grade/templates/ignored.mustache` → `<div>ignored</div>`

- [ ] **Step 2: 실패하는 테스트 작성**

`test/unit/infra/template-index.test.ts` 신규:
```ts
import { strict as assert } from 'assert';
import { join } from 'path';
import { TemplateIndex } from '../../../src/infrastructure/templates/template-index';
import { componentOfTemplateFile } from '../../../src/infrastructure/workspace/moodle-root-resolver';

const root = join(__dirname, '../../fixtures/mini-moodle');
const idx = new TemplateIndex();
idx.buildFromRoot(root); // 동기 — 모듈 로드 시 1회

describe('TemplateIndex', () => {
  it('코어: lib/templates → core', () => {
    assert.equal(idx.locationsOf('core', 'core_tmpl').length, 1);
    assert.ok(idx.locationsOf('core', 'core_tmpl')[0].uri.endsWith('lib/templates/core_tmpl.mustache'));
  });
  it('플러그인 + 하위 경로 이름', () => {
    assert.equal(idx.has('local_ubattend', 'svg/icon/hyflex'), true);
    assert.ok(idx.locationsOf('local_ubattend', 'svg/icon/hyflex')[0].uri.endsWith('svg/icon/hyflex.mustache'));
  });
  it('테마 오버라이드: 원본 + 오버라이드 둘 다 반환', () => {
    const locs = idx.locationsOf('local_ubattend', 'setting');
    assert.equal(locs.length, 2);
    assert.ok(locs.some(l => l.uri.includes(join('local', 'ubattend', 'templates'))));
    assert.ok(locs.some(l => l.uri.includes(join('theme', 'coursemos', 'templates'))));
  });
  it('테마 자체 템플릿은 theme_<name> 컴포넌트', () =>
    assert.equal(idx.has('theme_coursemos', 'own'), true));
  it('규칙 밖(코어 서브시스템 grade/templates)은 무시', () => {
    assert.equal(idx.has('core_grades', 'ignored'), false);
    assert.equal(idx.has('grade', 'ignored'), false);
  });
  it('없는 템플릿은 빈 배열', () => assert.deepEqual(idx.locationsOf('local_ubattend', 'nope'), []));
});

describe('componentOfTemplateFile (경로 역산)', () => {
  it('플러그인 하위 경로', () =>
    assert.deepEqual(componentOfTemplateFile(root, join(root, 'local/ubattend/templates/svg/icon/hyflex.mustache')),
      { component: 'local_ubattend', name: 'svg/icon/hyflex' }));
  it('코어', () =>
    assert.deepEqual(componentOfTemplateFile(root, join(root, 'lib/templates/core_tmpl.mustache')),
      { component: 'core', name: 'core_tmpl' }));
  it('테마 오버라이드는 덮는 대상 컴포넌트로', () =>
    assert.deepEqual(componentOfTemplateFile(root, join(root, 'theme/coursemos/templates/local_ubattend/setting.mustache')),
      { component: 'local_ubattend', name: 'setting' }));
  it('테마 자체 템플릿', () =>
    assert.deepEqual(componentOfTemplateFile(root, join(root, 'theme/coursemos/templates/own.mustache')),
      { component: 'theme_coursemos', name: 'own' }));
  it('규칙 밖 → null', () =>
    assert.equal(componentOfTemplateFile(root, join(root, 'grade/templates/ignored.mustache')), null));
  it('루트 밖 → null', () =>
    assert.equal(componentOfTemplateFile(root, '/etc/x.mustache'), null));
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx mocha test/unit/infra/template-index.test.ts`
Expected: FAIL — 모듈/`componentOfTemplateFile` 미존재로 로드 실패.

- [ ] **Step 4: 구현**

`src/domain/template-model/template-ref.ts`:
```ts
export interface TemplateRef { component: string; name: string; }

/** `component/name` 통짜 문자열 분해 — `/`가 없으면 템플릿 참조가 아니다(침묵). name은 하위 경로 포함 가능. */
export function parseTemplateRef(raw: string): TemplateRef | null {
  const i = raw.indexOf('/');
  if (i <= 0 || i === raw.length - 1) return null;
  return { component: raw.slice(0, i), name: raw.slice(i + 1) };
}
```

`src/domain/template-model/ports/template-repository.ts`:
```ts
import { SourceLocation } from '../../shared/value-objects';
export interface TemplateRepository {
  locationsOf(component: string, name: string): SourceLocation[];
  has(component: string, name: string): boolean;
}
```

`src/infrastructure/workspace/moodle-root-resolver.ts` — 파일 끝에 추가:
```ts
export interface TemplateFileRef { file: string; component: string; name: string; }

/** 컴포넌트꼴이면 테마 오버라이드 대상 컴포넌트로 본다(`local_ubattend`, `core`). */
function looksLikeComponent(seg: string): boolean { return seg === 'core' || seg.includes('_'); }

/** 템플릿 파일 경로 → { component, name } 역산. 규칙 밖(코어 서브시스템 등)은 null. */
export function componentOfTemplateFile(root: string, file: string): { component: string; name: string } | null {
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !rel.endsWith('.mustache')) return null;
  const parts = rel.split(path.sep);
  if (parts[0] === 'lib' && parts[1] === 'templates' && parts.length >= 3) {
    return { component: 'core', name: stripMustache(parts.slice(2).join('/')) };
  }
  const hit = pluginTypeOfRel(rel);
  if (!hit) return null;
  const restParts = hit.rest.split('/');
  if (restParts[0] !== 'templates' || restParts.length < 2) return null;
  const inner = restParts.slice(1);
  // 테마의 `templates/<component>/…`는 그 컴포넌트의 오버라이드
  if (hit.type === 'theme' && inner.length >= 2 && looksLikeComponent(inner[0])) {
    return { component: inner[0], name: stripMustache(inner.slice(1).join('/')) };
  }
  return { component: `${hit.type}_${hit.name}`, name: stripMustache(inner.join('/')) };
}

function stripMustache(s: string): string { return s.endsWith('.mustache') ? s.slice(0, -9) : s; }

/** 코어 + 모든 플러그인의 템플릿 파일 열거(하위 디렉터리 포함). */
export function listTemplateFiles(root: string): TemplateFileRef[] {
  const out: TemplateFileRef[] = [];
  const push = (file: string) => {
    const ref = componentOfTemplateFile(root, file);
    if (ref) out.push({ file, component: ref.component, name: ref.name });
  };
  const walk = (dir: string) => {
    for (const f of safeReaddirFiles(dir)) if (f.endsWith('.mustache')) push(path.join(dir, f));
    for (const d of safeReaddir(dir)) walk(path.join(dir, d));
  };
  const coreDir = path.join(root, 'lib', 'templates');
  if (fs.existsSync(coreDir)) walk(coreDir);
  for (const relDir of Object.values(PLUGIN_DIRS)) {
    const typeDir = path.join(root, relDir);
    if (!fs.existsSync(typeDir)) continue;
    for (const name of safeReaddir(typeDir)) {
      const tdir = path.join(typeDir, name, 'templates');
      if (fs.existsSync(tdir)) walk(tdir);
    }
  }
  return out;
}
```

`src/infrastructure/templates/template-index.ts`:
```ts
import { SourceLocation } from '../../domain/shared/value-objects';
import { TemplateRepository } from '../../domain/template-model/ports/template-repository';
import { listTemplateFiles } from '../workspace/moodle-root-resolver';

/** `component/name` → 템플릿 파일 위치. 원본과 테마 오버라이드가 함께 잡히면 둘 다 보관한다. */
export class TemplateIndex implements TemplateRepository {
  private byRef = new Map<string, SourceLocation[]>();

  buildFromRoot(root: string): void {
    const map = new Map<string, SourceLocation[]>();
    for (const { file, component, name } of listTemplateFiles(root)) {
      const key = `${component}/${name}`;
      const arr = map.get(key) ?? [];
      arr.push({ uri: file, line: 0, column: 0 });
      map.set(key, arr);
    }
    this.byRef = map;
  }

  locationsOf(component: string, name: string): SourceLocation[] {
    return this.byRef.get(`${component}/${name}`) ?? [];
  }
  has(component: string, name: string): boolean { return this.byRef.has(`${component}/${name}`); }
}
```

- [ ] **Step 5: 테스트 통과 + 회귀 확인**

Run: `npx mocha test/unit/infra/template-index.test.ts && npm run test:unit && npx tsc -noEmit`
Expected: 신규 12건 녹색 — 142건(130+12). 신규 픽스처(theme/coursemos, grade/, lib/templates)가 기존 열거 테스트에 영향 없는지 확인(`theme/coursemos`에는 db/install.xml·lang 없음 → 무영향).

- [ ] **Step 6: Commit**

```bash
git add src/domain/template-model src/infrastructure/templates src/infrastructure/workspace/moodle-root-resolver.ts test/fixtures/mini-moodle/lib/templates test/fixtures/mini-moodle/local/ubattend/templates test/fixtures/mini-moodle/theme test/fixtures/mini-moodle/grade test/unit/infra/template-index.test.ts
git commit -m "feat(infra): TemplateIndex — 템플릿 색인·경로 역산·테마 오버라이드"
```

---

### Task 3: templateCalls 팩트 + parseTemplateRef 테스트

**Files:**
- Modify: `src/domain/code-analysis/facts.ts`, `src/infrastructure/tree-sitter/tree-sitter-php-syntax.ts`
- Modify: `test/unit/domain/inference.test.ts`(base에 `templateCalls: []`), `test/unit/infra/cached-php-syntax.test.ts`(CountingFake 반환 리터럴에 `templateCalls: []`)
- Test: `test/unit/infra/tree-sitter.test.ts`, `test/unit/domain/template-ref.test.ts`(신규)

**Interfaces:**
- Consumes: Task 2 `parseTemplateRef`.
- Produces:
```ts
export interface TemplateCall { ref: string; refLine: number; refColumn: number; refIndex: number; index: number; }
// DocumentFacts.templateCalls: TemplateCall[] (필수, scope 없음)
```
Task 5가 소비.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/unit/domain/template-ref.test.ts` 신규:
```ts
import { strict as assert } from 'assert';
import { parseTemplateRef } from '../../../src/domain/template-model/template-ref';

describe('parseTemplateRef', () => {
  it('component/name 분해', () =>
    assert.deepEqual(parseTemplateRef('local_ubattend/setting'), { component: 'local_ubattend', name: 'setting' }));
  it('하위 경로는 name에 통째로', () =>
    assert.deepEqual(parseTemplateRef('local_ubattend/svg/icon/hyflex'), { component: 'local_ubattend', name: 'svg/icon/hyflex' }));
  it('슬래시 없음 → null', () => assert.equal(parseTemplateRef('setting'), null));
  it('앞뒤 슬래시만 → null', () => {
    assert.equal(parseTemplateRef('/setting'), null);
    assert.equal(parseTemplateRef('local_ubattend/'), null);
  });
});
```

`test/unit/infra/tree-sitter.test.ts` 파일 끝에 추가:
```ts
// Mustache: render_from_template 리터럴 호출 (스펙 2026-08-05)
const CODE6 = `<?php
function r() {
    echo $OUTPUT->render_from_template('local_ubattend/setting', $data);
    echo $this->render_from_template('local_ubattend/svg/icon/hyflex', []);
    echo $renderer->render_from_template('theme_coursemos/own', []);
    echo $OUTPUT->render_from_template($dynamic, []);
    echo $OUTPUT->other_method('local_ubattend/nope', []);
}
`;

describe('TreeSitterPhpSyntax — templateCalls (render_from_template)', () => {
  let syn: TreeSitterPhpSyntax; let f: any;
  before(async () => { syn = await TreeSitterPhpSyntax.create(); f = syn.facts(CODE6); });

  it('수신자 무관 추출($OUTPUT/$this/기타) — 3건', () => {
    const refs = f.templateCalls.map((x: any) => x.ref).sort();
    assert.deepEqual(refs, ['local_ubattend/setting', 'local_ubattend/svg/icon/hyflex', 'theme_coursemos/own']);
  });
  it('ref 위치 정확성', () => {
    const c = f.templateCalls.find((x: any) => x.ref === 'local_ubattend/setting');
    assert.equal(CODE6.slice(c.refIndex, c.refIndex + c.ref.length), 'local_ubattend/setting');
    assert.equal(c.refLine, 2);
  });
  it('동적 인자·다른 메서드는 비추출', () => {
    assert.ok(!f.templateCalls.some((x: any) => x.ref === 'local_ubattend/nope'));
    assert.equal(f.templateCalls.length, 3);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx mocha test/unit/domain/template-ref.test.ts test/unit/infra/tree-sitter.test.ts`
Expected: template-ref 4건 로드 실패(Task 2에서 만든 모듈이 있으므로 통과할 수도 있음 — 그 경우 정상), tree-sitter 신규 3건 FAIL(`f.templateCalls` undefined).

- [ ] **Step 3: 팩트 스키마 확장**

`src/domain/code-analysis/facts.ts` — `StringCall` 선언 다음에 추가:
```ts
export interface TemplateCall {
  ref: string;
  refLine: number; refColumn: number; refIndex: number;
  index: number;
}
```
`DocumentFacts`에 `templateCalls: TemplateCall[];` 추가.

컴파일 유지: `test/unit/domain/inference.test.ts`의 base 리터럴과 `test/unit/infra/cached-php-syntax.test.ts`의 `CountingFake.facts()` 반환 리터럴에 각각 `templateCalls: []` 추가.

- [ ] **Step 4: 어댑터 쿼리 + 추출**

`src/infrastructure/tree-sitter/tree-sitter-php-syntax.ts`:

1. facts import 나열에 `TemplateCall` 추가.
2. `Q_STRING_CALL` 아래에 추가:
```ts
// Mustache: render_from_template('component/name', …) — 수신자 무관($OUTPUT/$this/기타).
// 메서드명 필터는 캡처 후 코드에서(술어 미지원, Q_DATAARG 선례). 동적 인자는 string_content가 없어 비매칭.
const Q_TEMPLATE_CALL = `
  (member_call_expression
    name: (name) @method
    arguments: (arguments . (argument (string (string_content) @ref))))`;
```
3. `CompiledQueries`에 `templateCall: Parser.Query;`, `create()`의 queries 객체에 `templateCall: lang.query(Q_TEMPLATE_CALL),` 추가.
4. `facts()`의 `stringCalls` 블록 다음에:
```ts
const templateCalls: TemplateCall[] = [];
for (const { caps } of runMatches(this.queries.templateCall)) {
  const method = caps.get('method')!;
  if (method.text !== 'render_from_template') continue;
  const ref = caps.get('ref')!;
  templateCalls.push({
    ref: ref.text,
    refLine: ref.startPosition.row, refColumn: ref.startPosition.column, refIndex: ref.startIndex,
    index: method.startIndex,
  });
}
```
5. 반환 객체에 `templateCalls` 추가.

- [ ] **Step 5: 테스트 통과 + 회귀 확인**

Run: `npx mocha test/unit/domain/template-ref.test.ts test/unit/infra/tree-sitter.test.ts && npm run test:unit && npx tsc -noEmit && npx tsc -p tsconfig.test.json`
Expected: 신규 7건 녹색 — 149건(142+7).

- [ ] **Step 6: Commit**

```bash
git add src/domain/code-analysis/facts.ts src/infrastructure/tree-sitter/tree-sitter-php-syntax.ts test/unit/domain/template-ref.test.ts test/unit/infra/tree-sitter.test.ts test/unit/domain/inference.test.ts test/unit/infra/cached-php-syntax.test.ts
git commit -m "feat(infra): templateCalls 팩트 — render_from_template 리터럴 호출 추출"
```

---

### Task 4: PhpUsageIndex — 한 스캔에서 템플릿 참조까지

**Files:**
- Rename+Modify: `src/infrastructure/lang/string-usage-index.ts` → `src/infrastructure/usage/php-usage-index.ts` (클래스명 `StringUsageIndex` → `PhpUsageIndex`)
- Create: `src/domain/template-model/ports/template-usage-repository.ts`
- Modify: `src/extension.ts`(import 경로·클래스명), `test/unit/infra/string-usage-index.test.ts` → `test/unit/infra/php-usage-index.test.ts`
- Modify: 픽스처 `test/fixtures/mini-moodle/local/ubattend/view.php` (템플릿 호출 추가)

**Interfaces:**
- Consumes: 기존 `StringUsageRepository`·`normalizeComponent`·`isIndexablePhpPath`.
- Produces:
```ts
export interface TemplateUsageRepository { templateRefsOf(component: string, name: string): SourceLocation[]; }
export class PhpUsageIndex implements StringUsageRepository, TemplateUsageRepository { /* 기존 API 유지 + templateRefsOf */ }
export function isIndexablePhpPath(root: string, fsPath: string): boolean; // 무변경, 새 경로에서 export
```

- [ ] **Step 1: 픽스처에 템플릿 호출 추가**

`test/fixtures/mini-moodle/local/ubattend/view.php` 끝에 두 줄 추가(기존 4줄은 그대로):
```php
echo $OUTPUT->render_from_template('local_ubattend/setting', $data);
echo $OUTPUT->render_from_template('local_ubattend/svg/icon/hyflex', []);
```

- [ ] **Step 2: 실패하는 테스트 작성**

`git mv test/unit/infra/string-usage-index.test.ts test/unit/infra/php-usage-index.test.ts` 후, 파일 안의 `StringUsageIndex`를 전부 `PhpUsageIndex`로, import 경로를 `../../../src/infrastructure/usage/php-usage-index`로 바꾼다. describe 이름도 `PhpUsageIndex`로. 그리고 **별도 describe를 파일 끝에 추가**(기존 describe의 증분 테스트가 view.php 색인을 덮어쓰므로 독립 인스턴스 사용):

```ts
describe('PhpUsageIndex — 템플릿 참조(같은 스캔에서 수집)', () => {
  const tidx = new PhpUsageIndex(() => false);
  before(async () => { await tidx.buildFromRoot(root); });

  it('render_from_template 사용처를 component/name으로 조회', () => {
    const refs = tidx.templateRefsOf('local_ubattend', 'setting');
    assert.equal(refs.length, 1);
    assert.ok(refs[0].uri.endsWith('local/ubattend/view.php'));
  });
  it('하위 경로 이름도 조회', () =>
    assert.equal(tidx.templateRefsOf('local_ubattend', 'svg/icon/hyflex').length, 1));
  it('한 번의 스캔이 문자열·템플릿 색인을 모두 채운다', () => {
    assert.equal(tidx.referencesOf('local_ubattend', 'attendance_book').length, 1);
    assert.equal(tidx.templateRefsOf('local_ubattend', 'setting').length, 1);
  });
  it('증분 교체가 두 색인 모두에 반영', () => {
    const uri = join(root, 'local/ubattend/view.php');
    tidx.updateFileText(uri, "<?php\necho $OUTPUT->render_from_template('local_ubattend/other', []);\n");
    assert.equal(tidx.templateRefsOf('local_ubattend', 'setting').length, 0, '이전 템플릿 참조 제거');
    assert.equal(tidx.templateRefsOf('local_ubattend', 'other').length, 1, '새 참조 반영');
    assert.equal(tidx.referencesOf('local_ubattend', 'attendance_book').length, 0, '문자열 참조도 함께 교체');
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx mocha test/unit/infra/php-usage-index.test.ts`
Expected: FAIL — 새 모듈 경로/클래스명 미존재로 로드 실패.

- [ ] **Step 4: 구현**

```bash
mkdir -p src/infrastructure/usage
git mv src/infrastructure/lang/string-usage-index.ts src/infrastructure/usage/php-usage-index.ts
```

`src/domain/template-model/ports/template-usage-repository.ts` 신규:
```ts
import { SourceLocation } from '../../shared/value-objects';
export interface TemplateUsageRepository {
  templateRefsOf(component: string, name: string): SourceLocation[];
}
```

`src/infrastructure/usage/php-usage-index.ts` 수정:
1. import 경로가 한 단계 깊어지지 않았는지 확인 — `../../domain/...`으로 동일(둘 다 `src/infrastructure/<dir>/`). `StringUsageRepository` import는 그대로, 다음을 추가:
```ts
import { TemplateUsageRepository } from '../../domain/template-model/ports/template-usage-repository';
```
2. `USAGE_RE` 아래에 추가:
```ts
// 템플릿 사용처 — 같은 스캔에서 함께 수집한다(23초 스캔을 두 번 돌리지 않기 위해)
const TEMPLATE_USAGE_RE = /render_from_template\(\s*['"]([\w:./-]+)['"]/g;
```
3. `interface UsageEntry` 아래에 추가:
```ts
interface TemplateEntry { ref: string; loc: SourceLocation; }
```
4. 클래스 선언을 교체:
```ts
export class PhpUsageIndex implements StringUsageRepository, TemplateUsageRepository {
```
그리고 클래스 doc 주석을 다음으로 교체:
```ts
/** get_string·render_from_template 사용처의 워크스페이스 색인 — lazy 빌드 + 저장/삭제 시 파일 단위 증분.
 *  두 종류를 한 번의 파일 읽기에서 함께 추출한다(스캔 중복 방지). */
```
5. 필드 추가(기존 `byFile` 아래):
```ts
  private byTemplateRef = new Map<string, SourceLocation[]>();
  private templatesByFile = new Map<string, TemplateEntry[]>();
```
6. `updateFileText` 본문 끝(`if (entries.length) this.byFile.set(uri, entries);` 다음)에 템플릿 추출 추가:
```ts

    const prevT = this.templatesByFile.get(uri);
    if (prevT) { for (const e of prevT) this.removeTemplateEntry(e); this.templatesByFile.delete(uri); }
    const tEntries: TemplateEntry[] = [];
    TEMPLATE_USAGE_RE.lastIndex = 0;
    let tLastIdx = 0, tLastLine = 0;
    while ((m = TEMPLATE_USAGE_RE.exec(text))) {
      for (let i = tLastIdx; i < m.index; i++) if (text.charCodeAt(i) === 10) tLastLine++;
      tLastIdx = m.index;
      const lineStart = text.lastIndexOf('\n', m.index) + 1;
      const column = m.index - lineStart + m[0].search(/['"]/) + 1;
      const e: TemplateEntry = { ref: m[1], loc: { uri, line: tLastLine, column } };
      tEntries.push(e);
      this.addTemplateEntry(e);
    }
    if (tEntries.length) this.templatesByFile.set(uri, tEntries);
```
(주의: 기존 `prev` 제거 블록은 그대로 두고, 위 블록을 메서드 마지막에 덧붙인다. `m`은 기존 선언을 재사용한다.)
7. `referencesOf` 아래에 추가:
```ts
  templateRefsOf(component: string, name: string): SourceLocation[] {
    return this.byTemplateRef.get(`${component}/${name}`) ?? [];
  }
```
8. private 헬퍼 2개 추가(`removeEntry` 아래):
```ts
  private addTemplateEntry(e: TemplateEntry): void {
    const arr = this.byTemplateRef.get(e.ref);
    if (arr) arr.push(e.loc); else this.byTemplateRef.set(e.ref, [e.loc]);
  }
  private removeTemplateEntry(e: TemplateEntry): void {
    const arr = this.byTemplateRef.get(e.ref);
    if (!arr) return;
    const i = arr.indexOf(e.loc);
    if (i >= 0) arr.splice(i, 1);
  }
```

`src/extension.ts` — import 줄을 다음으로 교체(클래스명·경로):
```ts
import { PhpUsageIndex, isIndexablePhpPath } from './infrastructure/usage/php-usage-index';
```
그리고 `const usageIndex = new StringUsageIndex(...)`를 `const usageIndex = new PhpUsageIndex(...)`로.

- [ ] **Step 5: 테스트 통과 + 회귀 확인**

Run: `npx mocha test/unit/infra/php-usage-index.test.ts && npm run test:unit && npx tsc -noEmit`
Expected: 신규 4건 녹색 — 153건(149+4). 기존 사용처 테스트(문자열)가 픽스처에 추가된 템플릿 호출에도 그대로 녹색이어야 한다.

- [ ] **Step 6: Commit**

```bash
git add -A src/infrastructure src/domain/template-model src/extension.ts test/unit/infra test/fixtures/mini-moodle/local/ubattend/view.php
git commit -m "feat(infra): PhpUsageIndex — 한 스캔에서 문자열·템플릿 사용처 동시 색인"
```

---

### Task 5: 유즈케이스 3개

**Files:**
- Create: `src/application/resolve-template-definition.ts`, `src/application/find-template-references.ts`, `src/application/list-resolved-template-calls.ts`
- Test: `test/unit/application/template-usecases.test.ts`

**Interfaces:**
- Consumes: Task 2 `TemplateRepository`·`parseTemplateRef`, Task 3 `DocumentFacts.templateCalls`, Task 4 `TemplateUsageRepository`, 기존 `PhpSyntax`·`DefinitionResult`·`RangeItem`.
- Produces (Task 6이 소비):
```ts
ResolveTemplateDefinition.run(text: string, atIndex: number): DefinitionResult[]
FindTemplateReferences.run(component: string, name: string): SourceLocation[]
ListResolvedTemplateCalls.run(text: string): RangeItem[]
```

- [ ] **Step 1: 실패하는 테스트 작성**

`test/unit/application/template-usecases.test.ts` 신규:
```ts
import { strict as assert } from 'assert';
import { join } from 'path';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/tree-sitter/tree-sitter-php-syntax';
import { TemplateIndex } from '../../../src/infrastructure/templates/template-index';
import { ResolveTemplateDefinition } from '../../../src/application/resolve-template-definition';
import { FindTemplateReferences } from '../../../src/application/find-template-references';
import { ListResolvedTemplateCalls } from '../../../src/application/list-resolved-template-calls';

const root = join(__dirname, '../../fixtures/mini-moodle');
const tpl = new TemplateIndex();
tpl.buildFromRoot(root);

const CODE = `<?php
function r() {
  echo $OUTPUT->render_from_template('local_ubattend/setting', $d);
  echo $OUTPUT->render_from_template('local_ubattend/nope', $d);
  echo $OUTPUT->render_from_template('bare_no_slash', $d);
}
`;

describe('템플릿 유즈케이스 (E2E)', () => {
  it('정의 이동: 원본 + 테마 오버라이드 둘 다', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const at = CODE.indexOf('local_ubattend/setting') + 3;
    const locs = new ResolveTemplateDefinition(syn, tpl).run(CODE, at);
    assert.equal(locs.length, 2);
    assert.ok(locs.every(l => l.location.uri.endsWith('setting.mustache')));
  });
  it('정의 이동: 커서가 ref 밖이면 빈 배열', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    assert.deepEqual(new ResolveTemplateDefinition(syn, tpl).run(CODE, CODE.indexOf('function r')), []);
  });
  it('정의 이동: 색인에 없는 템플릿은 빈 배열', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const at = CODE.indexOf('local_ubattend/nope') + 3;
    assert.deepEqual(new ResolveTemplateDefinition(syn, tpl).run(CODE, at), []);
  });
  it('해석 범위: 존재하는 ref만(슬래시 없는 ref·미존재 제외)', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const r = new ListResolvedTemplateCalls(syn, tpl).run(CODE);
    assert.equal(r.length, 1);
    assert.equal(r[0].length, 'local_ubattend/setting'.length);
    assert.equal(r[0].line, 2);
  });
  it('참조 조회: 포트 위임', () => {
    const fake = { templateRefsOf: (c: string, n: string) => [{ uri: `${c}::${n}`, line: 0, column: 0 }] };
    assert.equal(new FindTemplateReferences(fake).run('local_ubattend', 'setting')[0].uri, 'local_ubattend::setting');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx mocha test/unit/application/template-usecases.test.ts`
Expected: FAIL — 유즈케이스 모듈 미존재.

- [ ] **Step 3: 구현**

`src/application/find-template-references.ts`:
```ts
import { TemplateUsageRepository } from '../domain/template-model/ports/template-usage-repository';
import { SourceLocation } from '../domain/shared/value-objects';

export class FindTemplateReferences {
  constructor(private usages: TemplateUsageRepository) {}
  run(component: string, name: string): SourceLocation[] {
    return this.usages.templateRefsOf(component, name);
  }
}
```

`src/application/resolve-template-definition.ts`:
```ts
import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { TemplateRepository } from '../domain/template-model/ports/template-repository';
import { parseTemplateRef } from '../domain/template-model/template-ref';
import { DefinitionResult } from './dto';

export class ResolveTemplateDefinition {
  constructor(private syntax: PhpSyntax, private templates: TemplateRepository) {}
  run(text: string, atIndex: number): DefinitionResult[] {
    const call = this.syntax.facts(text).templateCalls
      .find(c => c.refIndex <= atIndex && atIndex <= c.refIndex + c.ref.length);
    if (!call) return [];
    const ref = parseTemplateRef(call.ref);
    if (!ref) return [];
    return this.templates.locationsOf(ref.component, ref.name).map(location => ({ location }));
  }
}
```

`src/application/list-resolved-template-calls.ts`:
```ts
import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { TemplateRepository } from '../domain/template-model/ports/template-repository';
import { parseTemplateRef } from '../domain/template-model/template-ref';
import { RangeItem } from './dto';

/** 색인에 존재하는 템플릿 참조의 범위 — 하이라이트용 */
export class ListResolvedTemplateCalls {
  constructor(private syntax: PhpSyntax, private templates: TemplateRepository) {}
  run(text: string): RangeItem[] {
    const out: RangeItem[] = [];
    for (const c of this.syntax.facts(text).templateCalls) {
      const ref = parseTemplateRef(c.ref);
      if (!ref || !this.templates.has(ref.component, ref.name)) continue;
      out.push({ line: c.refLine, column0: c.refColumn, length: c.ref.length });
    }
    return out;
  }
}
```

- [ ] **Step 4: 테스트 통과 + 회귀 확인**

Run: `npx mocha test/unit/application/template-usecases.test.ts && npm run test:unit && npx tsc -noEmit`
Expected: 신규 5건 녹색 — 158건(153+5).

- [ ] **Step 5: Commit**

```bash
git add src/application test/unit/application/template-usecases.test.ts
git commit -m "feat(app): 템플릿 정의·참조·해석 범위 유즈케이스"
```

---

### Task 6: 프로바이더 2개 + 하이라이트 일반화 + 결선

**Files:**
- Create: `src/presentation/providers/template-definition-provider.ts`, `src/presentation/providers/template-reference-provider.ts`
- Rename+Modify: `src/presentation/string-highlight.ts` → `src/presentation/resolved-highlight.ts`
- Modify: `src/extension.ts`, `package.json`

**Interfaces:**
- Consumes: Task 5 유즈케이스 3개, Task 2 `componentOfTemplateFile`·`TemplateIndex`, 기존 `UsageIndexHandle`·`toVscodeLocation`·`RangeItem`.
- Produces: 사용자 기능 결선 완료.
```ts
export interface HighlightSource { setting: string; run(text: string): RangeItem[]; }
export function registerResolvedHighlight(ctx: vscode.ExtensionContext, sources: HighlightSource[]): void;
```

- [ ] **Step 1: 프로바이더 2개 생성**

`src/presentation/providers/template-definition-provider.ts`:
```ts
import * as vscode from 'vscode';
import { ResolveTemplateDefinition } from '../../application/resolve-template-definition';
import { toVscodeLocation } from '../mappers';

export class TemplateDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private uc: ResolveTemplateDefinition) {}
  provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): vscode.Location[] {
    return this.uc.run(doc.getText(), doc.offsetAt(pos)).map(r => toVscodeLocation(r.location));
  }
}
```

`src/presentation/providers/template-reference-provider.ts`:
```ts
import * as vscode from 'vscode';
import { FindTemplateReferences } from '../../application/find-template-references';
import { toVscodeLocation } from '../mappers';
import { UsageIndexHandle } from './lang-reference-provider';

/** .mustache 파일 어디서든 Shift+F12 → 그 템플릿의 render_from_template 사용처.
 *  파일 전체가 하나의 템플릿이므로 커서 위치 판정이 필요 없다. */
export class TemplateReferenceProvider implements vscode.ReferenceProvider {
  constructor(private uc: FindTemplateReferences, private usage: UsageIndexHandle,
              private refOf: (file: string) => { component: string; name: string } | null) {}

  async provideReferences(doc: vscode.TextDocument): Promise<vscode.Location[]> {
    const ref = this.refOf(doc.uri.fsPath);
    if (!ref) return [];
    if (!this.usage.built()) {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'CSMS Code: 사용처 색인 중…' },
        async progress => {
          let last = 0;
          await this.usage.build((done, total) => {
            const pct = total ? Math.floor((done / total) * 100) : 100;
            progress.report({ increment: pct - last, message: `${done}/${total} 파일` });
            last = pct;
          });
        });
    }
    return this.uc.run(ref.component, ref.name).map(toVscodeLocation);
  }
}
```

- [ ] **Step 2: 하이라이트 일반화**

```bash
git mv src/presentation/string-highlight.ts src/presentation/resolved-highlight.ts
```
`src/presentation/resolved-highlight.ts` 전체를 다음으로 교체:
```ts
import * as vscode from 'vscode';
import { RangeItem } from '../application/dto';
import { KeyedDebouncer } from './keyed-debouncer';

const HIGHLIGHT_DEBOUNCE_MS = 300;

/** 하이라이트 범위 공급자 — 설정 키(csmscode 하위)와 범위 계산을 함께 넘긴다. */
export interface HighlightSource { setting: string; run(text: string): RangeItem[]; }

/** 해석되는 참조(문자열 키·템플릿)를 링크 색상으로 장식 — 데코레이션·디바운서는 하나로 공유한다. */
export function registerResolvedHighlight(ctx: vscode.ExtensionContext, sources: HighlightSource[]) {
  const deco = vscode.window.createTextEditorDecorationType({ color: new vscode.ThemeColor('textLink.foreground') });
  const debouncer = new KeyedDebouncer(HIGHLIGHT_DEBOUNCE_MS);
  ctx.subscriptions.push(debouncer, deco);

  const refresh = (editor: vscode.TextEditor) => {
    const doc = editor.document;
    if (doc.uri.scheme !== 'file' || doc.languageId !== 'php') return;
    const cfg = vscode.workspace.getConfiguration('csmscode');
    const text = doc.getText();
    const ranges = sources
      .filter(s => cfg.get(s.setting, true))
      .flatMap(s => s.run(text))
      .map(r => new vscode.Range(r.line, r.column0, r.line, r.column0 + r.length));
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
      if (sources.some(s => e.affectsConfiguration(`csmscode.${s.setting}`))) {
        vscode.window.visibleTextEditors.forEach(refresh);
      }
    }),
  );
}
```

- [ ] **Step 3: extension.ts 결선**

1. import 교체·추가:
```ts
import { TemplateIndex } from './infrastructure/templates/template-index';
import { ResolveTemplateDefinition } from './application/resolve-template-definition';
import { FindTemplateReferences } from './application/find-template-references';
import { ListResolvedTemplateCalls } from './application/list-resolved-template-calls';
import { TemplateDefinitionProvider } from './presentation/providers/template-definition-provider';
import { TemplateReferenceProvider } from './presentation/providers/template-reference-provider';
import { registerResolvedHighlight } from './presentation/resolved-highlight';
```
(기존 `import { registerStringHighlight } from './presentation/string-highlight';` 줄은 삭제)
그리고 resolver import 줄에 `componentOfTemplateFile` 추가.

2. `strings.buildFromRoot(root);` 다음에:
```ts
  const templates = new TemplateIndex();
  templates.buildFromRoot(root);
```

3. `const listResolved = new ListResolvedStringCalls(syntax, strings);` 다음에:
```ts
  const resolveTpl = new ResolveTemplateDefinition(syntax, templates);
  const findTplRefs = new FindTemplateReferences(usageIndex);
  const listResolvedTpl = new ListResolvedTemplateCalls(syntax, templates);
```

4. 프로바이더 등록 블록에 두 줄 추가(기존 `registerReferenceProvider(...)` 다음):
```ts
    vscode.languages.registerDefinitionProvider(php, new TemplateDefinitionProvider(resolveTpl)),
    vscode.languages.registerReferenceProvider(
      { scheme: 'file', pattern: '**/templates/**/*.mustache' },
      new TemplateReferenceProvider(findTplRefs, {
        built: () => usageIndex.isBuilt,
        build: cb => usageBuild ?? (usageBuild = usageIndex.buildFromRoot(root, cb)),
      }, file => componentOfTemplateFile(root, file))),
```

5. `registerStringHighlight(ctx, listResolved);`를 다음으로 교체:
```ts
  registerResolvedHighlight(ctx, [
    { setting: 'strings.highlightResolved', run: t => listResolved.run(t) },
    { setting: 'templates.highlightResolved', run: t => listResolvedTpl.run(t) },
  ]);
```

6. lang watcher 블록 다음에 템플릿 워처 추가:
```ts
  // 템플릿 파일 변경 시 전체 재색인(기존 워처들과 동일 단순화)
  const tplWatcher = vscode.workspace.createFileSystemWatcher('**/templates/**/*.mustache');
  const retemplate = () => templates.buildFromRoot(root);
  ctx.subscriptions.push(tplWatcher, tplWatcher.onDidChange(retemplate), tplWatcher.onDidCreate(retemplate), tplWatcher.onDidDelete(retemplate));
```

- [ ] **Step 4: package.json 설정 추가**

`contributes.configuration.properties`에 기존 항목 형식 그대로 추가:
```json
"csmscode.templates.highlightResolved": {
  "type": "boolean",
  "default": true,
  "description": "해석되는 render_from_template 참조를 링크 색상(textLink.foreground)으로 하이라이팅합니다."
}
```

- [ ] **Step 5: 전체 검증**

Run: `npm run test:unit && npm run lint && npm run compile && npx tsc -p tsconfig.test.json`
Expected: 전부 통과 — 158건(하이라이트 일반화는 기존 테스트 대상 아님), eslint, 번들, 테스트 컴파일.

- [ ] **Step 6: Commit**

```bash
git add -A src/presentation src/extension.ts package.json
git commit -m "feat(presentation): 템플릿 정의·참조 프로바이더 + 하이라이트 일반화 결선"
```

---

### Task 7: 문서 갱신 + 최종 검증

**Files:**
- Modify: `README.md`, `docs/manual-verification.md`, `docs/PHASE2-BACKLOG.md`

**Interfaces:**
- Consumes: Task 1~6 완료 상태 (코드 변경 없음).
- Produces: 갱신된 문서.

- [ ] **Step 1: README 기능 줄 추가**

`README.md`의 언어 문자열 기능 줄 다음에 추가:
```markdown
- **Mustache 템플릿 인텔리전스**: `render_from_template('component/name', …)`에서 `.mustache` 파일로 이동(테마 오버라이드가 있으면 함께 표시)·템플릿 파일에서 사용처 참조 이동(Shift+F12)·해석되는 참조 하이라이팅
```

설정 표에 행 추가:
```markdown
| `csmscode.templates.highlightResolved` | `boolean` | `true` | 해석되는 render_from_template 참조를 링크 색상으로 하이라이팅 |
```

- [ ] **Step 2: 수동 검증 체크리스트 추가**

`docs/manual-verification.md`의 13번 다음에 추가:
```markdown
14. `$OUTPUT->render_from_template('local_ubattend/setting', …)`의 첫 인자 위에서 F12 → 해당 .mustache 파일로 이동(theme에 오버라이드가 있으면 두 위치가 함께 표시)
15. .mustache 파일 안에서 Shift+F12 → 그 템플릿을 쓰는 render_from_template 호출 목록(첫 요청 시 진행률, 이후 즉시)
16. 존재하는 템플릿 참조가 링크 색상으로 표시되고, csmscode.templates.highlightResolved=false 시 사라짐
17. blocks/ 플러그인(예: block_html)의 컬럼 완성·문자열 기능이 동작 — 이전에는 blocks 디렉터리가 색인되지 않았음
```

"## 알려진 제한" 문단 끝에 이어서 추가:
```markdown
템플릿 색인은 플러그인·코어(lib/templates)·테마 경로 규칙만 따릅니다 — 코어 서브시스템 템플릿
(`grade/templates` 등)과 JS의 `Templates.render()` 호출, 동적 인자 호출은 침묵합니다.
```

- [ ] **Step 3: 백로그 갱신**

`docs/PHASE2-BACKLOG.md`의 6번 항목을 다음으로 교체:
```markdown
6. ~~**nested subplugin 색인**~~ — ✅ 대부분 완료 (2026-08-05, 설계: `docs/superpowers/specs/2026-08-05-mustache-template-intelligence-design.md`). `PLUGIN_DIRS` 매핑으로 block(blocks)·tool(admin/tool)·qtype(question/type) 등 20개 타입이 실제 디렉터리로 해석된다. 남은 것: `PLUGIN_DIRS`에 없는 서드파티 서브플러그인 타입.
```

"## Plan 2" 섹션의 마지막 완료 불릿 다음에 추가:
```markdown
- ~~**Mustache 템플릿 인텔리전스**~~ — ✅ 완료 (2026-08-05, 같은 설계 문서). render_from_template 정의 이동(테마 오버라이드 포함)·템플릿에서 참조 이동·해석 참조 하이라이팅. 비목표: JS `Templates.render()`, 템플릿 이름 완성, .mustache 내부 인텔리전스.
```

- [ ] **Step 4: 최종 전체 검증**

Run: `npm run test:unit && npm run lint && npm run compile && npx tsc -p tsconfig.test.json`
Expected: 전부 통과 — 유닛 158건(128 기존 + 30 신규), eslint, 번들, 테스트 컴파일.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/manual-verification.md docs/PHASE2-BACKLOG.md
git commit -m "docs: Mustache 템플릿 기능 문서화 — 백로그 6번 부분 완료 반영"
```
