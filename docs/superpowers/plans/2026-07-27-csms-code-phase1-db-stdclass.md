# CSMS Code — Phase 1 Plan 1: DB stdClass 인텔리전스 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `$rec = $DB->get_record('local_ubattend_config', …)` 로 얻은 stdClass 변수에 대해 VSCode에서 컬럼 자동완성·정의이동·hover(한국어 COMMENT)·오타 진단(quick fix)을 제공하는 확장을 출시(.vsix)한다.

**Architecture:** DDD + Hexagonal. `domain/`(순수: Table 모델·RecordTypeInference)은 `vscode`/`fs`/`tree-sitter`를 import하지 않는다. `infrastructure/`가 포트를 구현(install.xml 파서, tree-sitter-php WASM, 워크스페이스 리졸버, 메모리 색인). `presentation/`(VSCode 프로바이더)만 `vscode`를 import하고 Mapper로 도메인/DTO ↔ VSCode 타입을 변환. `extension.ts`가 Composition Root로 수동 DI.

**Tech Stack:** TypeScript, VSCode Extension API, `web-tree-sitter@0.20.8` + `tree-sitter-wasms@0.1.13`(php grammar 0.22, WASM in-process), esbuild(번들), mocha + ts-node(단위) + `@vscode/test-electron`(통합), `@vscode/vsce`(패키징).

## Global Constraints

- **런타임/도구 버전(핀)**: `web-tree-sitter@0.20.8`, `tree-sitter-wasms@0.1.13`. 상향 금지(ABI 매칭). VSCode engine `^1.85.0`, Node 18+.
- **도메인 순수성**: `src/domain/**` 는 `vscode`·`fs`·`path`·`web-tree-sitter` 를 **import 금지**. ESLint `no-restricted-imports` 로 강제(Task 1).
- **추론 범위**: 현재 함수 스코프 내 로컬 데이터플로우만. 크로스 함수/리턴값 추론 금지.
- **오탐 방지**: 확신 있는 바인딩(RecordBinding ≠ null)일 때만 진단. `get_record_sql` 등 리터럴 테이블이 없으면 조용히 스킵.
- **워크스페이스 무관**: Moodle 루트·컴포넌트 맵을 런타임에 발견. 특정 저장소(hlulxp 등) 경로 하드코딩 금지.
- **UI 언어**: 한국어 우선. 진단/명령/설정 설명은 한국어.
- **커스텀 phpdoc 태그(`table:`) 미도입**. 기존 `@var`는 존중(테이블을 지정하지 않는 `stdClass` 주석만으로는 바인딩하지 않으며 진단도 내지 않음).
- **줄/열 기준**: 내부 도메인은 **0-based** line/column(VSCode·tree-sitter와 동일). install.xml 파싱 결과도 0-based.

---

## 검증된 기반 (스파이크 2026-07-27, 실측)

이 사실들은 스파이크로 검증됨 — Task 6은 이 값을 그대로 쓴다(암기·추측 금지).

**web-tree-sitter 0.20.8 API (CJS):**
```js
const Parser = require('web-tree-sitter');      // TS: import Parser from 'web-tree-sitter' (esModuleInterop)
await Parser.init({ locateFile: (f) => path.join(runtimeDir, f) }); // runtimeDir에 tree-sitter.wasm
const PHP = await Parser.Language.load(phpWasmPath);                 // tree-sitter-php.wasm
const parser = new Parser(); parser.setLanguage(PHP);
const tree = parser.parse(sourceText);
const q = PHP.query(queryString);
const caps = q.captures(tree.rootNode);   // [{ name, node }]
// node.text, node.startPosition{row,column}(0-based), node.startIndex(byte),
// node.parent, node.type, node.descendantForIndex(byteIndex)
```
- 번들할 WASM 2개: `node_modules/web-tree-sitter/tree-sitter.wasm`(런타임), `node_modules/tree-sitter-wasms/out/tree-sitter-php.wasm`(문법). 둘 다 `dist/`로 복사.
- 타입 정의는 패키지 내장(`tree-sitter-web.d.ts`). 별도 `@types` 불필요.

**검증된 PHP grammar 노드명:**
- `assignment_expression` (필드 `left:`, `right:`)
- `member_call_expression` (필드 `object:`, `name:`, `arguments:`) — 메서드 호출 `$DB->get_record(...)`
- `member_access_expression` (필드 `object:`, `name:`) — 프로퍼티 접근 `$r->userid` (호출과 구분됨)
- `variable_name` (자식 `name`), `string`→`string_content`, `arguments`→`argument`, `foreach_statement`, `object_creation_expression`, `function_definition`(name:/parameters:/body:)
- 쿼리 anchor `.` = 첫 인자만 매칭.

**검증된 쿼리 4종(캡처 확인됨):**
```scheme
; (A) 레코드 대입: $var = $recv->method('firstStringArg', ...)
(assignment_expression
  left: (variable_name (name) @var)
  right: (member_call_expression
    object: (variable_name (name) @recv)
    name: (name) @method
    arguments: (arguments . (argument (string (string_content) @table)))))

; (B) foreach 바인딩
(foreach_statement
  (variable_name (name) @collection)
  (variable_name (name) @item))

; (C) 프로퍼티 접근 $var->prop
(member_access_expression
  object: (variable_name (name) @var)
  name: (name) @prop)

; (D) 쓰기측 use: method('table', $data)  — insert_record/update_record 의 data 인자
(member_call_expression
  name: (name) @method
  arguments: (arguments
    . (argument (string (string_content) @table))
    (argument (variable_name (name) @datavar))))
```
주의: 쿼리 (A)의 `@table`은 `member_call_expression` 첫 인자가 문자열일 때만. `get_record_sql`은 첫 인자가 SQL이므로 도메인에서 method명으로 걸러 스킵. 쿼리 (B)는 `foreach ($a as $k => $v)`(key=>value) 형태는 커버 못함 → Task 6에서 값 변수만 잡도록 처리(스코프 밖 케이스는 무시).

---

## 파일 구조 (Plan 1 범위)

```
vscode-csms-code/
  package.json  tsconfig.json  .eslintrc.json  .vscodeignore  .mocharc.json  esbuild.mjs
  src/
    domain/
      shared/value-objects.ts
      moodle-model/table.ts
      moodle-model/ports/table-repository.ts
      moodle-model/services/column-validator.ts
      code-analysis/facts.ts
      code-analysis/ports/php-syntax.ts
      code-analysis/record-type-inference.ts
    application/
      dto.ts
      complete-record-columns.ts
      resolve-record-definition.ts
      describe-record-symbol.ts
      validate-record-columns.ts
    infrastructure/
      xmldb/xmldb-table-repository.ts
      workspace/moodle-root-resolver.ts
      indexing/index-store.ts
      tree-sitter/tree-sitter-php-syntax.ts
    presentation/
      mappers.ts
      providers/record-column-completion-provider.ts
      providers/record-definition-provider.ts
      providers/record-hover-provider.ts
      providers/record-diagnostics.ts
      providers/record-quickfix-provider.ts
    extension.ts
  test/
    unit/**            (도메인·애플리케이션·인프라 어댑터)
    integration/**     (@vscode/test-electron)
    fixtures/mini-moodle/  (축소 워크스페이스: version.php + local/ubattend/db/install.xml)
```

---

### Task 1: 스캐폴딩 + 도메인 값 객체

**Files:**
- Create: `package.json`, `tsconfig.json`, `.eslintrc.json`, `.mocharc.json`, `esbuild.mjs`, `.vscodeignore`
- Create: `src/domain/shared/value-objects.ts`
- Test: `test/unit/domain/value-objects.test.ts`

**Interfaces:**
- Produces:
  - `interface SourceLocation { uri: string; line: number; column: number }` (line/column 0-based)
  - `function parseFrankenstyle(raw: string): { type: string; name: string } | null` — `local_ubattend`→`{type:'local',name:'ubattend'}`, `core`/단일토큰→`{type:'core',name:raw}`
  - `function levenshtein(a: string, b: string): number`

- [ ] **Step 1: package.json 작성**

```json
{
  "name": "csms-code",
  "displayName": "CSMS Code",
  "description": "CSMS/Moodle 개발 지원 — DB 레코드 컬럼 인텔리전스",
  "version": "0.1.0",
  "publisher": "bluesoft",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Programming Languages"],
  "activationEvents": ["onLanguage:php"],
  "main": "./dist/extension.js",
  "scripts": {
    "compile": "tsc -noEmit && node esbuild.mjs",
    "bundle": "node esbuild.mjs --production",
    "lint": "eslint src --ext ts",
    "test:unit": "mocha",
    "package": "npm run bundle && vsce package --no-dependencies"
  },
  "dependencies": {
    "web-tree-sitter": "0.20.8",
    "tree-sitter-wasms": "0.1.13"
  },
  "devDependencies": {
    "@types/mocha": "^10.0.6",
    "@types/node": "^18.19.0",
    "@types/vscode": "^1.85.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "@vscode/test-electron": "^2.3.9",
    "@vscode/vsce": "^2.24.0",
    "esbuild": "^0.20.0",
    "eslint": "^8.57.0",
    "mocha": "^10.3.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.3"
  }
}
```

- [ ] **Step 2: tsconfig.json / .mocharc.json / .eslintrc.json / .vscodeignore 작성**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "module": "commonjs", "target": "ES2021", "lib": ["ES2021"],
    "outDir": "dist", "rootDir": ".", "strict": true,
    "esModuleInterop": true, "skipLibCheck": true, "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src", "test"]
}
```
`.mocharc.json`:
```json
{ "require": "ts-node/register", "spec": "test/unit/**/*.test.ts", "timeout": 10000 }
```
`.eslintrc.json` (도메인 순수성 강제):
```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  "overrides": [
    {
      "files": ["src/domain/**/*.ts"],
      "rules": {
        "no-restricted-imports": ["error", {
          "patterns": ["vscode", "fs", "path", "web-tree-sitter", "*/infrastructure/*", "*/presentation/*"]
        }]
      }
    }
  ]
}
```
`.vscodeignore`:
```
src/**
test/**
**/*.map
**/tsconfig.json
esbuild.mjs
.eslintrc.json
node_modules/**
!dist/**
```

- [ ] **Step 3: esbuild.mjs 작성 (번들 + WASM 복사)**

```js
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes('--production');
mkdirSync(join(__dirname, 'dist'), { recursive: true });

// WASM 2개를 dist로 복사 (런타임 + php 문법)
copyFileSync(
  join(__dirname, 'node_modules/web-tree-sitter/tree-sitter.wasm'),
  join(__dirname, 'dist/tree-sitter.wasm'));
copyFileSync(
  join(__dirname, 'node_modules/tree-sitter-wasms/out/tree-sitter-php.wasm'),
  join(__dirname, 'dist/tree-sitter-php.wasm'));

await esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true, outfile: 'dist/extension.js',
  external: ['vscode'], format: 'cjs', platform: 'node',
  minify: production, sourcemap: !production,
  // web-tree-sitter는 런타임에 fs로 wasm을 읽으므로 번들에 포함하되 wasm은 파일로 복사됨
});
console.log('build done');
```

- [ ] **Step 4: 실패하는 테스트 작성** — `test/unit/domain/value-objects.test.ts`

```ts
import { strict as assert } from 'assert';
import { parseFrankenstyle, levenshtein } from '../../../src/domain/shared/value-objects';

describe('parseFrankenstyle', () => {
  it('local_ubattend → {local, ubattend}', () => {
    assert.deepEqual(parseFrankenstyle('local_ubattend'), { type: 'local', name: 'ubattend' });
  });
  it('mod_assign → {mod, assign}', () => {
    assert.deepEqual(parseFrankenstyle('mod_assign'), { type: 'mod', name: 'assign' });
  });
  it('core → {core, core}', () => {
    assert.deepEqual(parseFrankenstyle('core'), { type: 'core', name: 'core' });
  });
});
describe('levenshtein', () => {
  it('coursid vs courseid = 1', () => assert.equal(levenshtein('coursid', 'courseid'), 1));
  it('equal = 0', () => assert.equal(levenshtein('abc', 'abc'), 0));
});
```

- [ ] **Step 5: 테스트 실행 → 실패 확인**

Run: `npm install && npm run test:unit`
Expected: FAIL — `Cannot find module '.../value-objects'`

- [ ] **Step 6: 최소 구현** — `src/domain/shared/value-objects.ts`

```ts
export interface SourceLocation { uri: string; line: number; column: number; }

export function parseFrankenstyle(raw: string): { type: string; name: string } | null {
  const s = raw.trim();
  if (!s) return null;
  const i = s.indexOf('_');
  if (i < 0) return { type: 'core', name: s };
  return { type: s.slice(0, i), name: s.slice(i + 1) };
}

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
```

- [ ] **Step 7: 테스트 통과 + 린트 + 컴파일 확인**

Run: `npm run test:unit && npm run lint && npm run compile`
Expected: 테스트 PASS, 린트 통과, `dist/extension.js`... (extension.ts 없으면 compile 실패 → Step 8에서 스텁 추가)

- [ ] **Step 8: extension.ts 스텁 + 커밋**

`src/extension.ts`:
```ts
import * as vscode from 'vscode';
export function activate(_context: vscode.ExtensionContext) {
  console.log('CSMS Code 활성화됨');
}
export function deactivate() { /* noop */ }
```
```bash
git init && git add -A && git commit -m "chore: 스캐폴딩 + 도메인 값 객체(parseFrankenstyle, levenshtein)"
```

---

### Task 2: Table + Field 모델 + ColumnValidator

**Files:**
- Create: `src/domain/moodle-model/table.ts`
- Create: `src/domain/moodle-model/services/column-validator.ts`
- Test: `test/unit/domain/table.test.ts`, `test/unit/domain/column-validator.test.ts`

**Interfaces:**
- Consumes: `SourceLocation`, `levenshtein` (Task 1)
- Produces:
  - `interface Field { name: string; type: string; comment: string; notnull: boolean; default: string | null; location: SourceLocation }`
  - `class Table { name; component; fields: Field[]; location: SourceLocation; fieldNames(): string[]; findField(name): Field|undefined; hasField(name): boolean }`
  - `function closestColumn(table: Table, column: string, maxDistance?: number): string | undefined`

- [ ] **Step 1: 실패 테스트** — `test/unit/domain/table.test.ts`

```ts
import { strict as assert } from 'assert';
import { Table, Field } from '../../../src/domain/moodle-model/table';

const loc = { uri: 'x', line: 0, column: 0 };
const f = (name: string): Field => ({ name, type: 'int', comment: '', notnull: true, default: null, location: loc });

describe('Table', () => {
  const t = new Table('local_ubattend_config', 'local_ubattend', [f('id'), f('courseid')], loc);
  it('hasField', () => { assert.equal(t.hasField('courseid'), true); assert.equal(t.hasField('nope'), false); });
  it('findField returns field', () => assert.equal(t.findField('id')?.name, 'id'));
  it('fieldNames', () => assert.deepEqual(t.fieldNames(), ['id', 'courseid']));
});
```

`test/unit/domain/column-validator.test.ts`:
```ts
import { strict as assert } from 'assert';
import { Table } from '../../../src/domain/moodle-model/table';
import { closestColumn } from '../../../src/domain/moodle-model/services/column-validator';

const loc = { uri: 'x', line: 0, column: 0 };
const t = new Table('t', 'c', ['id', 'courseid', 'userid'].map(n =>
  ({ name: n, type: 'int', comment: '', notnull: true, default: null, location: loc })), loc);

describe('closestColumn', () => {
  it('오타 coursid → courseid', () => assert.equal(closestColumn(t, 'coursid'), 'courseid'));
  it('거리 초과면 undefined', () => assert.equal(closestColumn(t, 'zzzzzzzz'), undefined));
});
```

- [ ] **Step 2: 실행 → 실패 확인**

Run: `npm run test:unit`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현** — `src/domain/moodle-model/table.ts`

```ts
import { SourceLocation } from '../shared/value-objects';

export interface Field {
  name: string; type: string; comment: string;
  notnull: boolean; default: string | null; location: SourceLocation;
}

export class Table {
  constructor(
    readonly name: string,
    readonly component: string,
    readonly fields: Field[],
    readonly location: SourceLocation,
  ) {}
  fieldNames(): string[] { return this.fields.map(f => f.name); }
  findField(name: string): Field | undefined { return this.fields.find(f => f.name === name); }
  hasField(name: string): boolean { return this.findField(name) !== undefined; }
}
```
`src/domain/moodle-model/services/column-validator.ts`:
```ts
import { Table } from '../table';
import { levenshtein } from '../../shared/value-objects';

export function closestColumn(table: Table, column: string, maxDistance = 3): string | undefined {
  let best: string | undefined; let bestD = maxDistance + 1;
  for (const name of table.fieldNames()) {
    const d = levenshtein(column, name);
    if (d < bestD) { bestD = d; best = name; }
  }
  return bestD <= maxDistance ? best : undefined;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:unit`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add -A && git commit -m "feat(domain): Table/Field 모델 + closestColumn 컬럼 검증"
```

---

### Task 3: TableRepository 포트 + XmldbTableRepository (위치 인식 파서)

**Files:**
- Create: `src/domain/moodle-model/ports/table-repository.ts`
- Create: `src/infrastructure/xmldb/xmldb-table-repository.ts`
- Create: `test/fixtures/mini-moodle/local/ubattend/db/install.xml`
- Test: `test/unit/infra/xmldb.test.ts`

**Interfaces:**
- Consumes: `Table`, `Field` (Task 2), `parseFrankenstyle` (Task 1)
- Produces:
  - `interface TableRepository { getTable(name: string): Table | undefined; allTableNames(): string[] }`
  - `function parseInstallXml(xmlText: string, uri: string, component: string): Table[]` — FIELD의 **정확한 line 번호**(0-based) 포함

- [ ] **Step 1: 픽스처 install.xml 작성** — `test/fixtures/mini-moodle/local/ubattend/db/install.xml`

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<XMLDB PATH="local/ubattend/db">
  <TABLES>
    <TABLE NAME="local_ubattend_config" COMMENT="설정 테이블">
      <FIELDS>
        <FIELD NAME="id" TYPE="int" LENGTH="10" NOTNULL="true" SEQUENCE="true"/>
        <FIELD NAME="courseid" TYPE="int" LENGTH="10" NOTNULL="true" DEFAULT="0" COMMENT="강좌 고유번호"/>
        <FIELD NAME="smart_status" TYPE="int" LENGTH="1" NOTNULL="false" DEFAULT="2" COMMENT="스마트 출결 상태값"/>
      </FIELDS>
    </TABLE>
  </TABLES>
</XMLDB>
```

- [ ] **Step 2: 실패 테스트** — `test/unit/infra/xmldb.test.ts`

```ts
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseInstallXml } from '../../../src/infrastructure/xmldb/xmldb-table-repository';

const xml = readFileSync(join(__dirname, '../../fixtures/mini-moodle/local/ubattend/db/install.xml'), 'utf8');

describe('parseInstallXml', () => {
  const tables = parseInstallXml(xml, '/x/install.xml', 'local_ubattend');
  const t = tables[0];
  it('테이블 1개, 이름', () => { assert.equal(tables.length, 1); assert.equal(t.name, 'local_ubattend_config'); });
  it('필드 3개', () => assert.deepEqual(t.fieldNames(), ['id', 'courseid', 'smart_status']));
  it('한국어 COMMENT', () => assert.equal(t.findField('courseid')?.comment, '강좌 고유번호'));
  it('type/notnull/default', () => {
    const c = t.findField('smart_status')!;
    assert.equal(c.type, 'int'); assert.equal(c.notnull, false); assert.equal(c.default, '2');
  });
  it('FIELD line 번호(0-based) 정확', () => {
    // courseid 는 파일에서 6번째 줄(index 5)
    assert.equal(t.findField('courseid')?.location.line, 5);
  });
});
```

- [ ] **Step 3: 실행 → 실패 확인**

Run: `npm run test:unit`
Expected: FAIL — 모듈 없음.

- [ ] **Step 4: 구현** — `src/infrastructure/xmldb/xmldb-table-repository.ts`

위치(line) 정보가 필요한데 DOM 파서는 위치를 안 준다. install.xml은 한 줄에 한 FIELD인 규칙이 강하므로 **줄 스캔** 방식으로 파싱한다(정규식 + 줄 인덱스). 견고성을 위해 TABLE/FIELD 태그를 줄 단위로 훑는다.

```ts
import { Table, Field } from '../../domain/moodle-model/table';
import { TableRepository } from '../../domain/moodle-model/ports/table-repository';

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return m ? m[1] : null;
}

/** install.xml → Table[] (FIELD line 0-based). 한 줄 다중 FIELD도 첫 위치로 근사. */
export function parseInstallXml(xmlText: string, uri: string, component: string): Table[] {
  const lines = xmlText.split(/\r?\n/);
  const tables: Table[] = [];
  let cur: { name: string; comment: string; line: number; fields: Field[] } | null = null;

  lines.forEach((line, idx) => {
    const tableOpen = line.match(/<TABLE\b[^>]*>/i);
    if (tableOpen) {
      const tag = tableOpen[0];
      const name = attr(tag, 'NAME');
      if (name) cur = { name, comment: attr(tag, 'COMMENT') ?? '', line: idx, fields: [] };
      return;
    }
    if (/<\/TABLE>/i.test(line) && cur) {
      tables.push(new Table(cur.name, component, cur.fields, { uri, line: cur.line, column: 0 }));
      cur = null;
      return;
    }
    const fieldTag = line.match(/<FIELD\b[^>]*\/?>/i);
    if (fieldTag && cur) {
      const tag = fieldTag[0];
      const name = attr(tag, 'NAME');
      if (!name) return;
      const col = Math.max(0, line.indexOf('<FIELD'));
      cur.fields.push({
        name,
        type: (attr(tag, 'TYPE') ?? '').toLowerCase(),
        comment: attr(tag, 'COMMENT') ?? '',
        notnull: (attr(tag, 'NOTNULL') ?? 'false').toLowerCase() === 'true',
        default: attr(tag, 'DEFAULT'),
        location: { uri, line: idx, column: col },
      });
    }
  });
  return tables;
}

/** 색인된 Table[]을 담는 단순 리포지토리 */
export class InMemoryTableRepository implements TableRepository {
  private byName = new Map<string, Table>();
  constructor(tables: Table[] = []) { this.replaceAll(tables); }
  replaceAll(tables: Table[]) { this.byName.clear(); for (const t of tables) this.byName.set(t.name, t); }
  upsert(tables: Table[]) { for (const t of tables) this.byName.set(t.name, t); }
  removeByUri(uri: string) { for (const [n, t] of this.byName) if (t.location.uri === uri) this.byName.delete(n); }
  getTable(name: string): Table | undefined { return this.byName.get(name); }
  allTableNames(): string[] { return [...this.byName.keys()]; }
}
```
`src/domain/moodle-model/ports/table-repository.ts`:
```ts
import { Table } from '../table';
export interface TableRepository {
  getTable(name: string): Table | undefined;
  allTableNames(): string[];
}
```

- [ ] **Step 5: 통과 확인 + 커밋**

Run: `npm run test:unit`
Expected: PASS
```bash
git add -A && git commit -m "feat(infra): install.xml 위치 인식 파서 + InMemoryTableRepository"
```

---

### Task 4: MoodleRootResolver (워크스페이스 발견 + 컴포넌트 맵)

**Files:**
- Create: `src/infrastructure/workspace/moodle-root-resolver.ts`
- Create(fixture): `test/fixtures/mini-moodle/version.php`, `test/fixtures/mini-moodle/lib/db/install.xml`
- Test: `test/unit/infra/resolver.test.ts`

**Interfaces:**
- Consumes: `parseFrankenstyle` (Task 1)
- Produces:
  - `function findMoodleRoot(startDir: string, detectInSubfolders?: string[]): string | undefined`
  - `function listInstallXmlFiles(root: string): { file: string; component: string }[]` — 코어 + 모든 플러그인 install.xml 경로와 frankenstyle 컴포넌트명

- [ ] **Step 1: 픽스처 보강**

`test/fixtures/mini-moodle/version.php`:
```php
<?php
$plugin->version = 2026010100;
$branch = '405';
```
`test/fixtures/mini-moodle/lib/db/install.xml`:
```xml
<?xml version="1.0" encoding="UTF-8" ?>
<XMLDB PATH="lib/db">
  <TABLES>
    <TABLE NAME="user" COMMENT="사용자">
      <FIELDS>
        <FIELD NAME="id" TYPE="int" LENGTH="10" NOTNULL="true" SEQUENCE="true"/>
        <FIELD NAME="username" TYPE="char" LENGTH="100" NOTNULL="true" COMMENT="아이디"/>
      </FIELDS>
    </TABLE>
  </TABLES>
</XMLDB>
```

- [ ] **Step 2: 실패 테스트** — `test/unit/infra/resolver.test.ts`

```ts
import { strict as assert } from 'assert';
import { join } from 'path';
import { findMoodleRoot, listInstallXmlFiles } from '../../../src/infrastructure/workspace/moodle-root-resolver';

const root = join(__dirname, '../../fixtures/mini-moodle');

describe('MoodleRootResolver', () => {
  it('version.php로 루트 발견', () => assert.equal(findMoodleRoot(root), root));
  it('하위 폴더에서 위로 탐색', () =>
    assert.equal(findMoodleRoot(join(root, 'local/ubattend/db')), root));
  it('install.xml 목록 + 컴포넌트명', () => {
    const list = listInstallXmlFiles(root).map(x => x.component).sort();
    assert.deepEqual(list, ['core', 'local_ubattend']); // lib/db → core, local/ubattend/db → local_ubattend
  });
});
```

- [ ] **Step 3: 실행 → 실패 확인**

Run: `npm run test:unit`
Expected: FAIL.

- [ ] **Step 4: 구현** — `src/infrastructure/workspace/moodle-root-resolver.ts`

Moodle 루트 판별: `version.php` + `lib/db/install.xml` 존재. frankenstyle 규칙: `lib/db`→`core`, `<type>/<name>/db`→`<type>_<name>`(플러그인 타입 디렉터리: mod, local, block, tool, report, enrol, auth, theme, format, qtype, ... — MVP는 알려진 타입 집합).

```ts
import * as fs from 'fs';
import * as path from 'path';

const PLUGIN_TYPES = ['mod','local','block','tool','report','enrol','auth','theme','format','qtype','filter','repository','portfolio','message','availability','customfield','contenttype','mlbackend','editor','atto','tinymce','profilefield','datafield','datapreset','gradeexport','gradeimport','gradereport','webservice','cachestore','cachelock'];

export function findMoodleRoot(startDir: string, detectInSubfolders: string[] = []): string | undefined {
  let dir = startDir;
  for (let i = 0; i < 40; i++) {
    if (isMoodleRoot(dir)) return dir;
    for (const sub of detectInSubfolders) {
      const cand = path.join(dir, sub);
      if (isMoodleRoot(cand)) return cand;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function isMoodleRoot(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'version.php')) &&
         fs.existsSync(path.join(dir, 'lib', 'db', 'install.xml'));
}

/** 코어 + 모든 플러그인의 db/install.xml 경로와 frankenstyle 컴포넌트명 */
export function listInstallXmlFiles(root: string): { file: string; component: string }[] {
  const out: { file: string; component: string }[] = [];
  const core = path.join(root, 'lib', 'db', 'install.xml');
  if (fs.existsSync(core)) out.push({ file: core, component: 'core' });
  for (const type of PLUGIN_TYPES) {
    const typeDir = path.join(root, type);
    if (!fs.existsSync(typeDir)) continue;
    for (const name of safeReaddir(typeDir)) {
      const f = path.join(typeDir, name, 'db', 'install.xml');
      if (fs.existsSync(f)) out.push({ file: f, component: `${type}_${name}` });
    }
  }
  return out;
}

function safeReaddir(dir: string): string[] {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); }
  catch { return []; }
}
```

- [ ] **Step 5: 통과 확인 + 커밋**

Run: `npm run test:unit`
Expected: PASS
```bash
git add -A && git commit -m "feat(infra): Moodle 루트 발견 + install.xml/컴포넌트 목록"
```

---

### Task 5: IndexStore (색인 조립 + 조회)

**Files:**
- Create: `src/infrastructure/indexing/index-store.ts`
- Test: `test/unit/infra/index-store.test.ts`

**Interfaces:**
- Consumes: `parseInstallXml`, `InMemoryTableRepository` (Task 3), `listInstallXmlFiles` (Task 4)
- Produces:
  - `class IndexStore implements TableRepository { buildFromRoot(root: string): void; updateFile(file: string, component: string): void; removeFile(uri: string): void; getTable(name); allTableNames() }`

- [ ] **Step 1: 실패 테스트** — `test/unit/infra/index-store.test.ts`

```ts
import { strict as assert } from 'assert';
import { join } from 'path';
import { IndexStore } from '../../../src/infrastructure/indexing/index-store';

const root = join(__dirname, '../../fixtures/mini-moodle');

describe('IndexStore', () => {
  const store = new IndexStore();
  store.buildFromRoot(root);
  it('코어 테이블 색인', () => assert.ok(store.getTable('user')));
  it('커스텀 테이블 색인', () => assert.ok(store.getTable('local_ubattend_config')));
  it('컬럼 접근', () =>
    assert.equal(store.getTable('local_ubattend_config')?.findField('courseid')?.comment, '강좌 고유번호'));
});
```

- [ ] **Step 2: 실행 → 실패 확인**

Run: `npm run test:unit`  → FAIL

- [ ] **Step 3: 구현** — `src/infrastructure/indexing/index-store.ts`

```ts
import * as fs from 'fs';
import { Table } from '../../domain/moodle-model/table';
import { TableRepository } from '../../domain/moodle-model/ports/table-repository';
import { parseInstallXml, InMemoryTableRepository } from '../xmldb/xmldb-table-repository';
import { listInstallXmlFiles } from '../workspace/moodle-root-resolver';

export class IndexStore implements TableRepository {
  private repo = new InMemoryTableRepository();

  buildFromRoot(root: string): void {
    const all: Table[] = [];
    for (const { file, component } of listInstallXmlFiles(root)) {
      all.push(...safeParse(file, component));
    }
    this.repo.replaceAll(all);
  }
  /** install.xml 하나가 바뀌면 그 파일의 테이블만 갱신 */
  updateFile(file: string, component: string): void {
    this.repo.removeByUri(file);
    this.repo.upsert(safeParse(file, component));
  }
  removeFile(uri: string): void { this.repo.removeByUri(uri); }

  getTable(name: string) { return this.repo.getTable(name); }
  allTableNames() { return this.repo.allTableNames(); }
}

function safeParse(file: string, component: string): Table[] {
  try { return parseInstallXml(fs.readFileSync(file, 'utf8'), file, component); }
  catch { return []; }
}
```

- [ ] **Step 4: 통과 확인 + 커밋**

Run: `npm run test:unit` → PASS
```bash
git add -A && git commit -m "feat(infra): IndexStore 색인 조립/조회/증분 갱신"
```

---

### Task 6: PhpSyntax 포트 + 중립 팩트 + TreeSitterPhpSyntax 어댑터

이 태스크가 tree-sitter를 실제로 증명한다. 위 "검증된 기반"의 쿼리·노드명·API를 **그대로** 사용한다.

**Files:**
- Create: `src/domain/code-analysis/facts.ts`
- Create: `src/domain/code-analysis/ports/php-syntax.ts`
- Create: `src/infrastructure/tree-sitter/tree-sitter-php-syntax.ts`
- Test: `test/unit/infra/tree-sitter.test.ts`

**Interfaces:**
- Produces (domain 팩트 타입):
  - `interface Scope { start: number; end: number }` (byte offset)
  - `interface RecordAssignment { varName; receiver; method; tableArg: string|null; index: number; scope: Scope }`
  - `interface ForeachBinding { collectionVar; itemVar; index; scope }`
  - `interface DataArgBinding { method; tableArg; dataVar; index; scope }`
  - `interface PhpdocVar { varName; typeText; index; scope }`
  - `interface PropertyAccess { varName; property; propLine; propColumn; propIndex; index; scope }`
  - `interface DocumentFacts { assignments; foreachBindings; dataArgBindings; phpdocVars; propertyAccesses }`
  - `interface PhpSyntax { facts(text: string): DocumentFacts }`
- Consumes: web-tree-sitter, 번들된 wasm 2개.

- [ ] **Step 1: 팩트 타입 + 포트 작성** — `src/domain/code-analysis/facts.ts`, `ports/php-syntax.ts`

```ts
// facts.ts
export interface Scope { start: number; end: number; }
export interface RecordAssignment { varName: string; receiver: string; method: string; tableArg: string | null; index: number; scope: Scope; }
export interface ForeachBinding { collectionVar: string; itemVar: string; index: number; scope: Scope; }
export interface DataArgBinding { method: string; tableArg: string; dataVar: string; index: number; scope: Scope; }
export interface PhpdocVar { varName: string; typeText: string; index: number; scope: Scope; }
export interface PropertyAccess { varName: string; property: string; propLine: number; propColumn: number; propIndex: number; index: number; scope: Scope; }
export interface DocumentFacts {
  assignments: RecordAssignment[];
  foreachBindings: ForeachBinding[];
  dataArgBindings: DataArgBinding[];
  phpdocVars: PhpdocVar[];
  propertyAccesses: PropertyAccess[];
}
```
```ts
// ports/php-syntax.ts
import { DocumentFacts } from '../facts';
export interface PhpSyntax { facts(text: string): DocumentFacts; }
```

- [ ] **Step 2: 실패 테스트** — `test/unit/infra/tree-sitter.test.ts`

```ts
import { strict as assert } from 'assert';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/tree-sitter/tree-sitter-php-syntax';

const CODE = `<?php
function process($cm) {
    $assign = $DB->get_record('assign', ['id' => 1]);
    $rows = $DB->get_records('local_ubattend_log', ['courseid' => 1]);
    foreach ($rows as $r) { echo $r->userid; }
    $data = new stdClass();
    $DB->insert_record('local_ubattend_config', $data);
    echo $assign->grade;
    /** @var \\stdClass $x */
    echo $x->foo;
}
`;

describe('TreeSitterPhpSyntax', () => {
  let syn: TreeSitterPhpSyntax; let f: any;
  before(async () => { syn = await TreeSitterPhpSyntax.create(); f = syn.facts(CODE); });

  it('assignment: $assign ← get_record(assign)', () => {
    const a = f.assignments.find((x: any) => x.varName === 'assign');
    assert.equal(a.method, 'get_record'); assert.equal(a.tableArg, 'assign');
  });
  it('assignment: $rows ← get_records(local_ubattend_log)', () => {
    const a = f.assignments.find((x: any) => x.varName === 'rows');
    assert.equal(a.method, 'get_records'); assert.equal(a.tableArg, 'local_ubattend_log');
  });
  it('foreach: rows→r', () => {
    const b = f.foreachBindings.find((x: any) => x.itemVar === 'r');
    assert.equal(b.collectionVar, 'rows');
  });
  it('property access: $assign->grade 위치정보', () => {
    const p = f.propertyAccesses.find((x: any) => x.varName === 'assign' && x.property === 'grade');
    assert.ok(p.propLine >= 0 && p.propIndex > 0);
  });
  it('dataArg: insert_record(local_ubattend_config, $data)', () => {
    const d = f.dataArgBindings.find((x: any) => x.dataVar === 'data');
    assert.equal(d.tableArg, 'local_ubattend_config'); assert.equal(d.method, 'insert_record');
  });
  it('phpdoc: @var stdClass $x', () => {
    const v = f.phpdocVars.find((x: any) => x.varName === 'x');
    assert.match(v.typeText, /stdClass/);
  });
  it('scope: 팩트가 함수 범위를 가진다', () => {
    assert.ok(f.assignments[0].scope.end > f.assignments[0].scope.start);
  });
});
```

- [ ] **Step 3: 실행 → 실패 확인**

Run: `npm run test:unit -- test/unit/infra/tree-sitter.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 4: 어댑터 구현** — `src/infrastructure/tree-sitter/tree-sitter-php-syntax.ts`

검증된 쿼리 4종 + phpdoc 정규식(comment는 tree-sitter가 내부 파싱 안 함) + scope 계산(부모를 타고 올라가 `function_definition`/`method_declaration` 등 발견, 없으면 파일 전체).

```ts
import * as path from 'path';
import Parser from 'web-tree-sitter';
import {
  DocumentFacts, RecordAssignment, ForeachBinding, DataArgBinding, PhpdocVar, PropertyAccess, Scope,
} from '../../domain/code-analysis/facts';
import { PhpSyntax } from '../../domain/code-analysis/ports/php-syntax';

const SCOPE_TYPES = new Set([
  'function_definition', 'method_declaration',
  'anonymous_function_creation_expression', 'arrow_function',
]);

// 검증된 쿼리 (스파이크 2026-07-27)
const Q_ASSIGN = `
  (assignment_expression
    left: (variable_name (name) @var)
    right: (member_call_expression
      object: (variable_name (name) @recv)
      name: (name) @method
      arguments: (arguments . (argument (string (string_content) @table)))))`;
const Q_ASSIGN_NOTABLE = `
  (assignment_expression
    left: (variable_name (name) @var)
    right: (member_call_expression
      object: (variable_name (name) @recv)
      name: (name) @method))`;
const Q_FOREACH = `
  (foreach_statement (variable_name (name) @collection) (variable_name (name) @item))`;
const Q_PROP = `
  (member_access_expression object: (variable_name (name) @var) name: (name) @prop)`;
const Q_DATAARG = `
  (member_call_expression
    name: (name) @method
    arguments: (arguments . (argument (string (string_content) @table)) (argument (variable_name (name) @datavar))))`;

export class TreeSitterPhpSyntax implements PhpSyntax {
  private constructor(private parser: Parser, private lang: Parser.Language) {}

  /** runtimeDir: tree-sitter.wasm + tree-sitter-php.wasm 이 있는 폴더(dist). 테스트에선 node_modules. */
  static async create(runtimeDir?: string): Promise<TreeSitterPhpSyntax> {
    const rt = runtimeDir ?? path.join(__dirname, '../../../node_modules/web-tree-sitter');
    const phpWasm = runtimeDir
      ? path.join(runtimeDir, 'tree-sitter-php.wasm')
      : path.join(__dirname, '../../../node_modules/tree-sitter-wasms/out/tree-sitter-php.wasm');
    await Parser.init({ locateFile: (f: string) => path.join(rt, f) });
    const lang = await Parser.Language.load(phpWasm);
    const parser = new Parser(); parser.setLanguage(lang);
    return new TreeSitterPhpSyntax(parser, lang);
  }

  facts(text: string): DocumentFacts {
    const tree = this.parser.parse(text);
    const root = tree.rootNode;
    const scopeOf = (node: Parser.SyntaxNode): Scope => {
      let p: Parser.SyntaxNode | null = node;
      while (p) { if (SCOPE_TYPES.has(p.type)) return { start: p.startIndex, end: p.endIndex }; p = p.parent; }
      return { start: 0, end: root.endIndex };
    };
    const capMap = (caps: { name: string; node: Parser.SyntaxNode }[]) => {
      const m = new Map<string, Parser.SyntaxNode>();
      for (const c of caps) m.set(c.name, c.node);
      return m;
    };
    // matches() 로 한 매치 내 캡처들을 묶는다
    const runMatches = (q: string) => this.lang.query(q).matches(root)
      .map(mt => ({ caps: capMap(mt.captures), anchor: mt.captures[0].node }));

    const assignments: RecordAssignment[] = [];
    for (const { caps } of runMatches(Q_ASSIGN)) {
      const varN = caps.get('var')!, recv = caps.get('recv')!, method = caps.get('method')!, table = caps.get('table');
      assignments.push({ varName: varN.text, receiver: recv.text, method: method.text,
        tableArg: table ? table.text : null, index: varN.startIndex, scope: scopeOf(varN) });
    }
    // 테이블 인자가 없는(get_record_sql 등) 대입도 잡아, 이미 잡힌 var는 제외
    const seen = new Set(assignments.map(a => a.index));
    for (const { caps } of runMatches(Q_ASSIGN_NOTABLE)) {
      const varN = caps.get('var')!;
      if (seen.has(varN.startIndex)) continue;
      assignments.push({ varName: varN.text, receiver: caps.get('recv')!.text, method: caps.get('method')!.text,
        tableArg: null, index: varN.startIndex, scope: scopeOf(varN) });
    }

    const foreachBindings: ForeachBinding[] = runMatches(Q_FOREACH).map(({ caps }) => {
      const item = caps.get('item')!;
      return { collectionVar: caps.get('collection')!.text, itemVar: item.text, index: item.startIndex, scope: scopeOf(item) };
    });

    const dataArgBindings: DataArgBinding[] = runMatches(Q_DATAARG).map(({ caps }) => {
      const dv = caps.get('datavar')!;
      return { method: caps.get('method')!.text, tableArg: caps.get('table')!.text, dataVar: dv.text, index: dv.startIndex, scope: scopeOf(dv) };
    });

    const propertyAccesses: PropertyAccess[] = runMatches(Q_PROP).map(({ caps }) => {
      const v = caps.get('var')!, p = caps.get('prop')!;
      return { varName: v.text, property: p.text, propLine: p.startPosition.row, propColumn: p.startPosition.column,
        propIndex: p.startIndex, index: v.startIndex, scope: scopeOf(v) };
    });

    const phpdocVars = extractPhpdocVars(text, root, scopeOf);

    return { assignments, foreachBindings, dataArgBindings, phpdocVars, propertyAccesses };
  }
}

/** @var Type $x — comment 노드 텍스트에 정규식(트리시터가 phpdoc 내부를 파싱 안 함) */
function extractPhpdocVars(text: string, root: Parser.SyntaxNode, scopeOf: (n: Parser.SyntaxNode) => Scope): PhpdocVar[] {
  const out: PhpdocVar[] = [];
  const re = /@var\s+([^\s]+)\s+\$(\w+)/g;
  const walk = (n: Parser.SyntaxNode) => {
    if (n.type === 'comment') {
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(n.text))) out.push({ typeText: m[1], varName: m[2], index: n.startIndex, scope: scopeOf(n) });
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
  };
  walk(root);
  return out;
}
```

- [ ] **Step 5: 통과 확인 (실제 tree-sitter 로드)**

Run: `npm run test:unit -- test/unit/infra/tree-sitter.test.ts`
Expected: PASS — 모든 팩트가 예상대로 추출됨. (실패 시 S-expression 을 `tree.rootNode.toString()`으로 덤프해 노드명 재확인 — 스파이크 스크립트 참조: scratchpad `ts-spike/dump.cjs`)

- [ ] **Step 6: 커밋**

```bash
git add -A && git commit -m "feat(infra): tree-sitter-php WASM 어댑터 — 레코드/foreach/프로퍼티/쓰기/phpdoc 팩트 추출"
```

---

### Task 7: RecordTypeInference (순수 도메인 — 차별화의 핵심)

**Files:**
- Create: `src/domain/code-analysis/record-type-inference.ts`
- Test: `test/unit/domain/inference.test.ts`

**Interfaces:**
- Consumes: `DocumentFacts` 및 하위 팩트(Task 6), `Scope`
- Produces:
  - `type BindingSource = 'phpdoc' | 'assignment' | 'foreach' | 'dataarg'`
  - `interface RecordBinding { varName: string; tableName: string; source: BindingSource }`
  - `class RecordTypeInference { infer(facts: DocumentFacts, varName: string, atIndex: number, scope: Scope, tableExists: (t: string) => boolean): RecordBinding | null }`
- 규칙(우선순위): ① phpdoc(테이블로 해석되는 타입) → ② 직전 대입(RECORD_METHODS + 리터럴 테이블) → ③ foreach(컬렉션의 테이블) → ④ dataarg(스코프 전역). 어느 것도 실존 테이블로 해석 안 되면 `null`(→ 완성/진단 안 함).

- [ ] **Step 1: 실패 테스트 (표 기반)** — `test/unit/domain/inference.test.ts`

```ts
import { strict as assert } from 'assert';
import { RecordTypeInference } from '../../../src/domain/code-analysis/record-type-inference';
import { DocumentFacts } from '../../../src/domain/code-analysis/facts';

const S = { start: 0, end: 1000 };
const base: DocumentFacts = { assignments: [], foreachBindings: [], dataArgBindings: [], phpdocVars: [], propertyAccesses: [] };
const known = (t: string) => ['user', 'assign', 'local_ubattend_config', 'local_ubattend_log'].includes(t);
const inf = new RecordTypeInference();

describe('RecordTypeInference', () => {
  it('get_record 대입 → 테이블 바인딩', () => {
    const f = { ...base, assignments: [{ varName: 'u', receiver: 'DB', method: 'get_record', tableArg: 'user', index: 10, scope: S }] };
    assert.deepEqual(inf.infer(f, 'u', 50, S, known), { varName: 'u', tableName: 'user', source: 'assignment' });
  });
  it('get_record_sql(리터럴 없음) → null', () => {
    const f = { ...base, assignments: [{ varName: 'u', receiver: 'DB', method: 'get_record_sql', tableArg: null, index: 10, scope: S }] };
    assert.equal(inf.infer(f, 'u', 50, S, known), null);
  });
  it('대입이 커서 뒤면 무시(직전만)', () => {
    const f = { ...base, assignments: [{ varName: 'u', receiver: 'DB', method: 'get_record', tableArg: 'user', index: 90, scope: S }] };
    assert.equal(inf.infer(f, 'u', 50, S, known), null);
  });
  it('foreach: 컬렉션 테이블 → 항목 바인딩', () => {
    const f = { ...base,
      assignments: [{ varName: 'rows', receiver: 'DB', method: 'get_records', tableArg: 'local_ubattend_log', index: 10, scope: S }],
      foreachBindings: [{ collectionVar: 'rows', itemVar: 'r', index: 20, scope: S }] };
    assert.deepEqual(inf.infer(f, 'r', 50, S, known), { varName: 'r', tableName: 'local_ubattend_log', source: 'foreach' });
  });
  it('dataarg: 스코프 전역(사용이 접근 뒤여도)', () => {
    const f = { ...base, dataArgBindings: [{ method: 'insert_record', tableArg: 'local_ubattend_config', dataVar: 'data', index: 90, scope: S }] };
    assert.deepEqual(inf.infer(f, 'data', 50, S, known), { varName: 'data', tableName: 'local_ubattend_config', source: 'dataarg' });
  });
  it('phpdoc 테이블 타입이 대입보다 우선', () => {
    const f = { ...base,
      phpdocVars: [{ varName: 'u', typeText: 'assign', index: 5, scope: S }],
      assignments: [{ varName: 'u', receiver: 'DB', method: 'get_record', tableArg: 'user', index: 10, scope: S }] };
    assert.equal(inf.infer(f, 'u', 50, S, known)!.source, 'phpdoc');
  });
  it('bare stdClass phpdoc는 바인딩 아님(대입으로 폴백)', () => {
    const f = { ...base,
      phpdocVars: [{ varName: 'u', typeText: '\\stdClass', index: 5, scope: S }],
      assignments: [{ varName: 'u', receiver: 'DB', method: 'get_record', tableArg: 'user', index: 10, scope: S }] };
    assert.equal(inf.infer(f, 'u', 50, S, known)!.source, 'assignment');
  });
});
```

- [ ] **Step 2: 실행 → 실패 확인**

Run: `npm run test:unit -- test/unit/domain/inference.test.ts` → FAIL

- [ ] **Step 3: 구현** — `src/domain/code-analysis/record-type-inference.ts`

```ts
import { DocumentFacts, Scope } from './facts';

export type BindingSource = 'phpdoc' | 'assignment' | 'foreach' | 'dataarg';
export interface RecordBinding { varName: string; tableName: string; source: BindingSource; }

const RECORD_METHODS = new Set([
  'get_record', 'get_record_select', 'get_records', 'get_records_select',
  'get_recordset', 'get_recordset_select',
]);

function sameScope(a: Scope, b: Scope): boolean { return a.start === b.start && a.end === b.end; }

export class RecordTypeInference {
  infer(facts: DocumentFacts, varName: string, atIndex: number, scope: Scope,
        tableExists: (t: string) => boolean): RecordBinding | null {

    // ① phpdoc: 타입 텍스트가 실존 테이블명으로 해석되면 우선
    const doc = nearestPreceding(
      facts.phpdocVars.filter(v => v.varName === varName && sameScope(v.scope, scope)), atIndex);
    if (doc) {
      const t = stripType(doc.typeText);
      if (tableExists(t)) return { varName, tableName: t, source: 'phpdoc' };
      // bare stdClass 등 → 폴백(아래로)
    }

    // ② 직전 대입: RECORD_METHODS + 리터럴 테이블
    const asg = nearestPreceding(
      facts.assignments.filter(a => a.varName === varName && sameScope(a.scope, scope)
        && RECORD_METHODS.has(a.method) && a.tableArg && tableExists(a.tableArg)), atIndex);
    if (asg) return { varName, tableName: asg.tableArg!, source: 'assignment' };

    // ③ foreach: 항목 변수 → 컬렉션의 테이블
    const fe = nearestPreceding(
      facts.foreachBindings.filter(b => b.itemVar === varName && sameScope(b.scope, scope)), atIndex);
    if (fe) {
      const coll = nearestPreceding(
        facts.assignments.filter(a => a.varName === fe.collectionVar && sameScope(a.scope, scope)
          && RECORD_METHODS.has(a.method) && a.tableArg && tableExists(a.tableArg)), fe.index);
      if (coll) return { varName, tableName: coll.tableArg!, source: 'foreach' };
    }

    // ④ dataarg: 스코프 전역(insert/update 의 data 인자)
    const da = facts.dataArgBindings.find(d => d.dataVar === varName && sameScope(d.scope, scope) && tableExists(d.tableArg));
    if (da) return { varName, tableName: da.tableArg, source: 'dataarg' };

    return null;
  }
}

function nearestPreceding<T extends { index: number }>(items: T[], atIndex: number): T | undefined {
  let best: T | undefined;
  for (const it of items) if (it.index <= atIndex && (!best || it.index > best.index)) best = it;
  return best;
}

/** `\stdClass` / `stdClass` / `?table` 등에서 마지막 식별자만 */
function stripType(t: string): string {
  return t.replace(/^[?\\]+/, '').split('\\').pop() ?? t;
}
```

- [ ] **Step 4: 통과 확인 + 커밋**

Run: `npm run test:unit -- test/unit/domain/inference.test.ts` → PASS
```bash
git add -A && git commit -m "feat(domain): RecordTypeInference — 스코프 로컬 변수↔테이블 추론(차별화 핵심)"
```

---

### Task 8: 애플리케이션 유즈케이스 (완성/정의/hover/진단)

**Files:**
- Create: `src/application/dto.ts`
- Create: `src/application/complete-record-columns.ts`, `resolve-record-definition.ts`, `describe-record-symbol.ts`, `validate-record-columns.ts`
- Test: `test/unit/application/usecases.test.ts`

**Interfaces:**
- Consumes: `PhpSyntax`(port), `TableRepository`(port), `RecordTypeInference`, `closestColumn`
- Produces:
  - `interface ColumnItem { name: string; type: string; comment: string }`
  - `interface DefinitionResult { location: SourceLocation }`
  - `interface HoverResult { markdown: string }`
  - `interface DiagnosticItem { line: number; column: number; length: number; message: string; suggestion?: string; column0: number }`
  - 4개 유즈케이스 클래스(생성자 주입: syntax, tables, inference):
    - `CompleteRecordColumns.run(text, varName, atIndex, scope?): ColumnItem[]`
    - `ResolveRecordDefinition.run(text, atIndex): DefinitionResult | null`
    - `DescribeRecordSymbol.run(text, atIndex): HoverResult | null`
    - `ValidateRecordColumns.run(text): DiagnosticItem[]`

각 유즈케이스는 팩트에서 접근 지점을 찾아 추론→테이블 조회→결과 매핑. 완성은 provider가 준 varName+atIndex+scope 사용(스코프는 해당 위치를 포함하는 팩트 스코프로 계산).

- [ ] **Step 1: 실패 테스트** — `test/unit/application/usecases.test.ts`

```ts
import { strict as assert } from 'assert';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/tree-sitter/tree-sitter-php-syntax';
import { InMemoryTableRepository } from '../../../src/infrastructure/xmldb/xmldb-table-repository';
import { Table } from '../../../src/domain/moodle-model/table';
import { RecordTypeInference } from '../../../src/domain/code-analysis/record-type-inference';
import { ValidateRecordColumns } from '../../../src/application/validate-record-columns';

const loc = { uri: 'x', line: 0, column: 0 };
const mk = (name: string, cols: string[]) => new Table(name, 'c', cols.map(n => ({ name: n, type: 'int', comment: n === 'courseid' ? '강좌번호' : '', notnull: true, default: null, location: loc })), loc);
const repo = new InMemoryTableRepository([mk('local_ubattend_config', ['id', 'courseid', 'smart_status'])]);

const CODE = `<?php
function f() {
  $c = $DB->get_record('local_ubattend_config', ['id' => 1]);
  echo $c->courseid;   // 정상
  echo $c->coursid;    // 오타 → courseid 제안
}
`;

describe('ValidateRecordColumns', () => {
  it('오타 컬럼만 진단 + 제안', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const uc = new ValidateRecordColumns(syn, repo, new RecordTypeInference());
    const diags = uc.run(CODE);
    assert.equal(diags.length, 1);
    assert.match(diags[0].message, /coursid/);
    assert.equal(diags[0].suggestion, 'courseid');
  });
});
```

- [ ] **Step 2: 실행 → 실패 확인**

Run: `npm run test:unit -- test/unit/application/usecases.test.ts` → FAIL

- [ ] **Step 3: 구현** — DTO + 4개 유즈케이스

`src/application/dto.ts`:
```ts
import { SourceLocation } from '../domain/shared/value-objects';
export interface ColumnItem { name: string; type: string; comment: string; }
export interface DefinitionResult { location: SourceLocation; }
export interface HoverResult { markdown: string; }
export interface DiagnosticItem { line: number; column0: number; length: number; message: string; suggestion?: string; }
```
`src/application/validate-record-columns.ts`:
```ts
import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { TableRepository } from '../domain/moodle-model/ports/table-repository';
import { RecordTypeInference } from '../domain/code-analysis/record-type-inference';
import { closestColumn } from '../domain/moodle-model/services/column-validator';
import { DiagnosticItem } from './dto';

export class ValidateRecordColumns {
  constructor(private syntax: PhpSyntax, private tables: TableRepository, private inference: RecordTypeInference) {}
  run(text: string): DiagnosticItem[] {
    const facts = this.syntax.facts(text);
    const exists = (t: string) => this.tables.getTable(t) !== undefined;
    const out: DiagnosticItem[] = [];
    for (const pa of facts.propertyAccesses) {
      const binding = this.inference.infer(facts, pa.varName, pa.index, pa.scope, exists);
      if (!binding) continue;                 // 확신 없으면 스킵(오탐 방지)
      const table = this.tables.getTable(binding.tableName);
      if (!table || table.hasField(pa.property)) continue;
      out.push({
        line: pa.propLine, column0: pa.propColumn, length: pa.property.length,
        message: `'${binding.tableName}' 테이블에 '${pa.property}' 컬럼이 없습니다.`,
        suggestion: closestColumn(table, pa.property),
      });
    }
    return out;
  }
}
```
`src/application/complete-record-columns.ts`:
```ts
import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { TableRepository } from '../domain/moodle-model/ports/table-repository';
import { RecordTypeInference } from '../domain/code-analysis/record-type-inference';
import { ColumnItem } from './dto';
import { Scope } from '../domain/code-analysis/facts';

export class CompleteRecordColumns {
  constructor(private syntax: PhpSyntax, private tables: TableRepository, private inference: RecordTypeInference) {}
  run(text: string, varName: string, atIndex: number): ColumnItem[] {
    const facts = this.syntax.facts(text);
    const exists = (t: string) => this.tables.getTable(t) !== undefined;
    const scope = scopeContaining(facts, atIndex);
    const binding = this.inference.infer(facts, varName, atIndex, scope, exists);
    if (!binding) return [];
    const table = this.tables.getTable(binding.tableName);
    if (!table) return [];
    return table.fields.map(f => ({ name: f.name, type: f.type, comment: f.comment }));
  }
}
// 커서 위치를 포함하는 가장 좁은 팩트 스코프(없으면 전체)
function scopeContaining(facts: { assignments: {scope:Scope}[]; propertyAccesses: {scope:Scope}[]; foreachBindings:{scope:Scope}[]; dataArgBindings:{scope:Scope}[]; phpdocVars:{scope:Scope}[] }, atIndex: number): Scope {
  let best: Scope = { start: 0, end: Number.MAX_SAFE_INTEGER };
  const all = [...facts.assignments, ...facts.propertyAccesses, ...facts.foreachBindings, ...facts.dataArgBindings, ...facts.phpdocVars];
  for (const { scope } of all)
    if (scope.start <= atIndex && atIndex <= scope.end && (scope.end - scope.start) < (best.end - best.start)) best = scope;
  return best;
}
```
`src/application/resolve-record-definition.ts`:
```ts
import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { TableRepository } from '../domain/moodle-model/ports/table-repository';
import { RecordTypeInference } from '../domain/code-analysis/record-type-inference';
import { DefinitionResult } from './dto';

export class ResolveRecordDefinition {
  constructor(private syntax: PhpSyntax, private tables: TableRepository, private inference: RecordTypeInference) {}
  run(text: string, atIndex: number): DefinitionResult | null {
    const facts = this.syntax.facts(text);
    const pa = facts.propertyAccesses.find(p => p.propIndex <= atIndex && atIndex <= p.propIndex + p.property.length);
    if (!pa) return null;
    const exists = (t: string) => this.tables.getTable(t) !== undefined;
    const binding = this.inference.infer(facts, pa.varName, pa.index, pa.scope, exists);
    if (!binding) return null;
    const field = this.tables.getTable(binding.tableName)?.findField(pa.property);
    return field ? { location: field.location } : null;
  }
}
```
`src/application/describe-record-symbol.ts`:
```ts
import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { TableRepository } from '../domain/moodle-model/ports/table-repository';
import { RecordTypeInference } from '../domain/code-analysis/record-type-inference';
import { HoverResult } from './dto';

export class DescribeRecordSymbol {
  constructor(private syntax: PhpSyntax, private tables: TableRepository, private inference: RecordTypeInference) {}
  run(text: string, atIndex: number): HoverResult | null {
    const facts = this.syntax.facts(text);
    const pa = facts.propertyAccesses.find(p => p.propIndex <= atIndex && atIndex <= p.propIndex + p.property.length);
    if (!pa) return null;
    const exists = (t: string) => this.tables.getTable(t) !== undefined;
    const binding = this.inference.infer(facts, pa.varName, pa.index, pa.scope, exists);
    if (!binding) return null;
    const field = this.tables.getTable(binding.tableName)?.findField(pa.property);
    if (!field) return null;
    const parts = [`**${binding.tableName}.${field.name}**  \`${field.type}\``];
    if (field.comment) parts.push(field.comment);
    return { markdown: parts.join('\n\n') };
  }
}
```

- [ ] **Step 4: 통과 확인 + 커밋**

Run: `npm run test:unit -- test/unit/application/usecases.test.ts` → PASS
```bash
git add -A && git commit -m "feat(app): 컬럼 완성/정의/hover/진단 유즈케이스"
```

---

### Task 9: Presentation — VSCode 프로바이더 + Composition Root

**Files:**
- Create: `src/presentation/mappers.ts`
- Create: `src/presentation/providers/*.ts` (completion, definition, hover, diagnostics, quickfix)
- Modify: `src/extension.ts`
- Test: `test/integration/db-intel.test.ts`, `test/integration/runTest.ts`

**Interfaces:**
- Consumes: 4개 유즈케이스(Task 8), `IndexStore`(Task 5), `TreeSitterPhpSyntax`(Task 6), `findMoodleRoot`(Task 4)
- Produces: 등록된 VSCode 프로바이더. `activate()`가 루트 발견→색인→syntax 생성→DI→register.

- [ ] **Step 1: 통합 테스트 하니스** — `test/integration/runTest.ts`

```ts
import * as path from 'path';
import { runTests } from '@vscode/test-electron';
async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  const workspace = path.resolve(__dirname, '../../test/fixtures/mini-moodle');
  await runTests({ extensionDevelopmentPath, extensionTestsPath, launchArgs: [workspace, '--disable-extensions'] });
}
main();
```
(참고: `test/integration/suite/index.ts`는 mocha 프로그램적 구동 — 표준 @vscode/test-electron 템플릿을 사용. package.json에 `test:integration` 스크립트 추가: 먼저 `tsc`로 test를 컴파일 후 `node ./dist-test/integration/runTest.js`.)

- [ ] **Step 2: 실패하는 통합 테스트** — `test/integration/suite/db-intel.test.ts`

```ts
import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

const root = path.resolve(__dirname, '../../../test/fixtures/mini-moodle');

suite('DB 인텔리전스 통합', () => {
  test('$c->coursid 오타 진단 발생', async () => {
    const uri = vscode.Uri.file(path.join(root, 'local/ubattend/probe.php'));
    const content = "<?php\nfunction f(){ $c = $DB->get_record('local_ubattend_config', ['id'=>1]); echo $c->coursid; }\n";
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await new Promise(r => setTimeout(r, 1500)); // 색인+진단 대기
    const diags = vscode.languages.getDiagnostics(uri);
    assert.ok(diags.some(d => /coursid/.test(d.message)), '오타 진단이 있어야 함');
  });
});
```

- [ ] **Step 3: 실행 → 실패 확인**

Run: `npm run test:integration`
Expected: FAIL — 프로바이더 미등록으로 진단 없음.

- [ ] **Step 4: 매퍼 + 프로바이더 구현**

`src/presentation/mappers.ts`:
```ts
import * as vscode from 'vscode';
import { SourceLocation } from '../domain/shared/value-objects';
export function toVscodeLocation(loc: SourceLocation): vscode.Location {
  return new vscode.Location(vscode.Uri.file(loc.uri), new vscode.Position(loc.line, loc.column));
}
```
`src/presentation/providers/record-diagnostics.ts`:
```ts
import * as vscode from 'vscode';
import { ValidateRecordColumns } from '../../application/validate-record-columns';

export function registerDiagnostics(ctx: vscode.ExtensionContext, uc: ValidateRecordColumns) {
  const coll = vscode.languages.createDiagnosticCollection('csmscode');
  ctx.subscriptions.push(coll);
  const refresh = (doc: vscode.TextDocument) => {
    if (doc.languageId !== 'php') return;
    if (!vscode.workspace.getConfiguration('csmscode').get('diagnostics.enable', true)) { coll.delete(doc.uri); return; }
    const items = uc.run(doc.getText());
    coll.set(doc.uri, items.map(i => {
      const range = new vscode.Range(i.line, i.column0, i.line, i.column0 + i.length);
      const d = new vscode.Diagnostic(range, i.suggestion ? `${i.message} '${i.suggestion}' 을(를) 의도하셨나요?` : i.message, vscode.DiagnosticSeverity.Warning);
      d.code = i.suggestion ? `csms.column.${i.suggestion}` : 'csms.column';
      d.source = 'CSMS Code';
      return d;
    }));
  };
  vscode.workspace.textDocuments.forEach(refresh);
  ctx.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument(e => refresh(e.document)),
    vscode.workspace.onDidCloseTextDocument(d => coll.delete(d.uri)),
  );
}
```
`src/presentation/providers/record-column-completion-provider.ts`:
```ts
import * as vscode from 'vscode';
import { CompleteRecordColumns } from '../../application/complete-record-columns';

export class RecordColumnCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private uc: CompleteRecordColumns) {}
  provideCompletionItems(doc: vscode.TextDocument, pos: vscode.Position): vscode.CompletionItem[] {
    const line = doc.lineAt(pos.line).text.slice(0, pos.character);
    const m = line.match(/\$(\w+)->(\w*)$/);   // $var->partial
    if (!m) return [];
    const varName = m[1];
    const atIndex = doc.offsetAt(new vscode.Position(pos.line, pos.character - m[0].length)) + 1; // '$' 다음(변수 위치)
    const cols = this.uc.run(doc.getText(), varName, atIndex);
    return cols.map(c => {
      const it = new vscode.CompletionItem(c.name, vscode.CompletionItemKind.Field);
      it.detail = c.type;
      if (c.comment) it.documentation = new vscode.MarkdownString(c.comment);
      return it;
    });
  }
}
```
`src/presentation/providers/record-definition-provider.ts`:
```ts
import * as vscode from 'vscode';
import { ResolveRecordDefinition } from '../../application/resolve-record-definition';
import { toVscodeLocation } from '../mappers';

export class RecordDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private uc: ResolveRecordDefinition) {}
  provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): vscode.Location | null {
    const r = this.uc.run(doc.getText(), doc.offsetAt(pos));
    return r ? toVscodeLocation(r.location) : null;
  }
}
```
`src/presentation/providers/record-hover-provider.ts`:
```ts
import * as vscode from 'vscode';
import { DescribeRecordSymbol } from '../../application/describe-record-symbol';

export class RecordHoverProvider implements vscode.HoverProvider {
  constructor(private uc: DescribeRecordSymbol) {}
  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | null {
    const r = this.uc.run(doc.getText(), doc.offsetAt(pos));
    return r ? new vscode.Hover(new vscode.MarkdownString(r.markdown)) : null;
  }
}
```
`src/presentation/providers/record-quickfix-provider.ts`:
```ts
import * as vscode from 'vscode';

export class RecordQuickFixProvider implements vscode.CodeActionProvider {
  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const d of ctx.diagnostics) {
      if (typeof d.code !== 'string' || !d.code.startsWith('csms.column.')) continue;
      const suggestion = d.code.slice('csms.column.'.length);
      const fix = new vscode.CodeAction(`'${suggestion}' 으로 변경`, vscode.CodeActionKind.QuickFix);
      fix.edit = new vscode.WorkspaceEdit();
      fix.edit.replace(doc.uri, d.range, suggestion);
      fix.diagnostics = [d];
      actions.push(fix);
    }
    return actions;
  }
}
```

- [ ] **Step 5: Composition Root** — `src/extension.ts`

```ts
import * as vscode from 'vscode';
import * as path from 'path';
import { IndexStore } from './infrastructure/indexing/index-store';
import { TreeSitterPhpSyntax } from './infrastructure/tree-sitter/tree-sitter-php-syntax';
import { findMoodleRoot, listInstallXmlFiles } from './infrastructure/workspace/moodle-root-resolver';
import { RecordTypeInference } from './domain/code-analysis/record-type-inference';
import { ValidateRecordColumns } from './application/validate-record-columns';
import { CompleteRecordColumns } from './application/complete-record-columns';
import { ResolveRecordDefinition } from './application/resolve-record-definition';
import { DescribeRecordSymbol } from './application/describe-record-symbol';
import { registerDiagnostics } from './presentation/providers/record-diagnostics';
import { RecordColumnCompletionProvider } from './presentation/providers/record-column-completion-provider';
import { RecordDefinitionProvider } from './presentation/providers/record-definition-provider';
import { RecordHoverProvider } from './presentation/providers/record-hover-provider';
import { RecordQuickFixProvider } from './presentation/providers/record-quickfix-provider';

export async function activate(ctx: vscode.ExtensionContext) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;
  const subs = vscode.workspace.getConfiguration('csmscode').get<string[]>('detectInSubfolders', []);
  const root = findMoodleRoot(folder.uri.fsPath, subs);
  if (!root) { console.log('CSMS Code: Moodle 루트를 찾지 못했습니다.'); return; }

  const store = new IndexStore();
  store.buildFromRoot(root);

  // 번들 시 dist에 tree-sitter.wasm + tree-sitter-php.wasm 복사됨
  const syntax = await TreeSitterPhpSyntax.create(path.join(ctx.extensionPath, 'dist'));
  const inference = new RecordTypeInference();

  const validate = new ValidateRecordColumns(syntax, store, inference);
  const complete = new CompleteRecordColumns(syntax, store, inference);
  const resolve = new ResolveRecordDefinition(syntax, store, inference);
  const describe = new DescribeRecordSymbol(syntax, store, inference);

  const php: vscode.DocumentSelector = { language: 'php', scheme: 'file' };
  ctx.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(php, new RecordColumnCompletionProvider(complete), '>'),
    vscode.languages.registerDefinitionProvider(php, new RecordDefinitionProvider(resolve)),
    vscode.languages.registerHoverProvider(php, new RecordHoverProvider(describe)),
    vscode.languages.registerCodeActionsProvider(php, new RecordQuickFixProvider(), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
  );
  registerDiagnostics(ctx, validate);

  // install.xml 변경 시 증분 재색인
  const watcher = vscode.workspace.createFileSystemWatcher('**/db/install.xml');
  const reindex = () => store.buildFromRoot(root); // 단순: 전체 재색인(파일 수가 많지 않음). 최적화는 후속.
  ctx.subscriptions.push(watcher, watcher.onDidChange(reindex), watcher.onDidCreate(reindex), watcher.onDidDelete(reindex));
}
export function deactivate() { /* noop */ }
```

- [ ] **Step 6: 통합 테스트 통과 확인**

Run: `npm run test:integration`
Expected: PASS — probe.php 의 `$c->coursid` 에 경고 진단이 뜬다.
(실패 시: activate 가 test workspace(mini-moodle)를 루트로 인식하는지, dist에 wasm이 복사됐는지 확인.)

- [ ] **Step 7: 커밋**

```bash
git add -A && git commit -m "feat(presentation): VSCode 프로바이더(완성/정의/hover/진단/quickfix) + Composition Root"
```

---

### Task 10: 설정 contributes + 패키징(.vsix) + 수동 검증

**Files:**
- Modify: `package.json` (contributes.configuration)
- Create: `README.md`, `docs/manual-verification.md`

**Interfaces:**
- Consumes: 전체 확장.
- Produces: 설치 가능한 `csms-code-0.1.0.vsix`.

- [ ] **Step 1: package.json 에 설정 기여 추가**

`package.json` 에 `contributes` 추가:
```json
"contributes": {
  "configuration": {
    "title": "CSMS Code",
    "properties": {
      "csmscode.detectInSubfolders": {
        "type": "array", "items": { "type": "string" }, "default": [],
        "description": "Moodle 루트가 하위 폴더에 있을 때 탐색할 폴더명 목록 (예: [\"moodle\"])."
      },
      "csmscode.diagnostics.enable": {
        "type": "boolean", "default": true,
        "description": "DB 레코드 컬럼 오타 진단을 켭니다."
      }
    }
  }
}
```

- [ ] **Step 2: README + 수동 검증 문서 작성**

`docs/manual-verification.md` (실제 저장소에서 확인할 체크리스트):
```
1. `npm run package` → csms-code-0.1.0.vsix 생성 확인
2. code --install-extension csms-code-0.1.0.vsix
3. ~/workspace/hlulxp 열기
4. local/ubattend 의 아무 php에서:
   - $config = $DB->get_record('local_ubattend_config', ...); 아래 줄에서 `$config->` 입력 → 컬럼 목록 + 한국어 설명 표시
   - 존재하지 않는 컬럼(예: $config->coursid) → 노란 경고 + quick fix 'courseid'
   - 컬럼에 F12(정의로 이동) → install.xml 해당 FIELD 줄로 점프
   - 컬럼에 hover → 'table.column  int  강좌 고유번호'
   - foreach ($rows as $r) 에서 $r-> (get_records 대상) 컬럼 완성
   - $data = new stdClass(); ... insert_record('local_ubattend_config', $data) 위에서 $data-> 완성
5. 설정 csmscode.diagnostics.enable=false → 진단 사라짐 확인
```

- [ ] **Step 3: 패키징 실행**

Run: `npm run package`
Expected: `csms-code-0.1.0.vsix` 생성. (esbuild 번들 + dist에 wasm 2개 포함 확인: `unzip -l csms-code-0.1.0.vsix | grep wasm` → tree-sitter.wasm, tree-sitter-php.wasm 존재)

- [ ] **Step 4: 커밋 + 태그**

```bash
git add -A && git commit -m "feat: 설정 기여 + 패키징(.vsix) + 수동 검증 문서 — Phase1 Plan1 완료"
git tag v0.1.0-db-intel
```

---

## Self-Review (계획 vs 스펙)

**스펙 커버리지(§5 Phase 1):**
- (1) Workspace Resolver + ComponentMap + 워처 → Task 4, 9(watcher) ✓
- (2) TableIndex(install.xml) → Task 3, 5 ✓
- (3) StringIndex(lang) → **Plan 2로 분리**(의도적, advisor 권고) — 이 계획 범위 밖 명시.
- (4) PHP Parse Layer → Task 6 ✓
- (5) DB 컬럼 go-to-def/완성/hover → Task 8, 9 ✓
- (6) stdClass 진단 + quick fix → Task 8(Validate) + 9(diagnostics, quickfix) ✓
- (7) 언어 문자열 → **Plan 2** (분리)

**차별화(§4) 커버리지:** 타입소스 ①get_record ②foreach ③쓰기측 dataarg ④phpdoc 존중 → Task 7 전부 ✓. 읽기+쓰기 양방향 → 완성/진단 모두 dataarg 포함 ✓. 스코프 로컬 경계 → sameScope + nearestPreceding ✓.

**타입 일관성 확인:** `Table.findField`/`hasField`/`fieldNames`, `TableRepository.getTable`, `RecordTypeInference.infer(facts,varName,atIndex,scope,tableExists)`, `DocumentFacts` 필드명 — Task 6/7/8에서 동일 시그니처 사용 확인. `DiagnosticItem.column0` 사용 일치(Task 8 정의 = Task 9 소비). ✓

**Placeholder 스캔:** 코드 스텁/“TODO”/“적절히 처리” 없음. tree-sitter 쿼리는 스파이크 실측값. VSCode 통합 부분은 실패 테스트 + 정확한 명령 + 기대결과로 근거화(advisor 지침). ✓

**미해결(실행 중 확인 필요, placeholder 아님):**
- Task 6 `SCOPE_TYPES` 중 `function_definition` 만 실측 검증됨; `method_declaration`/클로저 노드명은 실행 시 S-expr로 확인(Step 5 지침에 명시).
- Task 9 통합 테스트의 `@vscode/test-electron` suite 로더(`suite/index.ts`)는 표준 템플릿 사용 — 실행 시 생성.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-27-csms-code-phase1-db-stdclass.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — 태스크마다 새 서브에이전트 디스패치, 태스크 사이 리뷰, 빠른 반복.

**2. Inline Execution** — 이 세션에서 executing-plans로 배치 실행 + 체크포인트 리뷰.

**어느 방식으로 진행할까요?** (Plan 2 = 언어 문자열은 Plan 1 출시 후 별도 작성)
