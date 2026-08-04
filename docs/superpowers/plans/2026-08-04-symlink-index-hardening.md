# symlink 색인 + 재발 방지 하드닝 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 심볼릭 링크된 플러그인 디렉터리를 색인에 포함시키고(백로그 4번), scopeContaining 구조적 유도 + 회귀 핀 2건으로 재발을 방지한다(백로그 12번).

**Architecture:** `safeReaddir`가 심볼릭 링크 엔트리만 `fs.statSync`(링크 추적)로 확인 — 일반 디렉터리는 기존 Dirent 빠른 경로 유지, 깨진 링크는 조용히 제외. `scopeContaining`은 `DocumentFacts`를 직접 받아 `Object.values().flat()`으로 후보를 구조적으로 유도(수기 열거 제거).

**Tech Stack:** TypeScript (strict), mocha + ts-node, 런타임 tmp 픽스처(`fs.mkdtempSync`).

**Spec:** `docs/superpowers/specs/2026-08-04-symlink-index-hardening-design.md`

## Global Constraints

- `listInstallXmlFiles`·`scopeContaining` 호출부 시그니처 무변경(스코프 선택 로직도 무변경 — 후보 유도 방식만).
- symlink 테스트 픽스처는 **런타임 tmp 생성**(`os.tmpdir()`) + `after`에서 `fs.rmSync(tmp, { recursive: true, force: true })` 정리 — 저장소에 symlink 커밋 금지(Windows 체크아웃 파손).
- 깨진 심볼릭 링크에서 크래시 금지 — 조용히 제외.
- 유닛 테스트: `npm run test:unit`. 개별 파일: `npx mocha test/unit/<path>.test.ts`.
- 커밋 메시지: `feat|fix|docs(scope): 한국어 요약`.

---

### Task 1: symlink 플러그인 색인

**Files:**
- Modify: `src/infrastructure/workspace/moodle-root-resolver.ts` (`safeReaddir` + 헬퍼 추가)
- Test: `test/unit/infra/resolver.test.ts`

**Interfaces:**
- Consumes: 기존 `listInstallXmlFiles(root)` (무변경 — 내부 `safeReaddir`만 변경).
- Produces: 동작 변경만 — 심볼릭 링크된 플러그인 디렉터리가 열거된다. Task 2·3은 이 변경에 의존하지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/unit/infra/resolver.test.ts` — import에 `fs`/`os` 추가하고 파일 끝에 describe 추가:

```ts
import * as fs from 'fs';
import * as os from 'os';
```

```ts
// symlink 플러그인 색인 (스펙 2026-08-04): Dirent.isDirectory()는 링크를 따라가지 않아
// 심볼릭 링크된 플러그인이 열거에서 탈락했다. 픽스처는 런타임 tmp 생성(커밋된 symlink는 Windows 파손).
describe('MoodleRootResolver — symlink 플러그인 색인', () => {
  let tmp: string;
  before(() => {
    tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-symlink-'));
    // 플러그인 본체(루트 밖 위치를 흉내)
    fs.mkdirSync(join(tmp, 'target', 'db'), { recursive: true });
    fs.writeFileSync(join(tmp, 'target', 'db', 'install.xml'), '<XMLDB/>');
    // Moodle 루트 + 링크된 플러그인
    fs.mkdirSync(join(tmp, 'root', 'lib', 'db'), { recursive: true });
    fs.writeFileSync(join(tmp, 'root', 'version.php'), '<?php');
    fs.writeFileSync(join(tmp, 'root', 'lib', 'db', 'install.xml'), '<XMLDB/>');
    fs.mkdirSync(join(tmp, 'root', 'local'));
    fs.symlinkSync(join(tmp, 'target'), join(tmp, 'root', 'local', 'linked'), 'dir');
  });
  after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('심볼릭 링크된 플러그인 디렉터리도 열거된다', () => {
    const list = listInstallXmlFiles(join(tmp, 'root')).map(x => x.component).sort();
    assert.deepEqual(list, ['core', 'local_linked']);
  });
  it('깨진 심볼릭 링크는 조용히 제외(크래시 없음)', () => {
    fs.symlinkSync(join(tmp, 'nowhere'), join(tmp, 'root', 'local', 'broken'), 'dir');
    const list = listInstallXmlFiles(join(tmp, 'root')).map(x => x.component).sort();
    assert.deepEqual(list, ['core', 'local_linked']);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx mocha test/unit/infra/resolver.test.ts`
Expected: 첫 테스트 FAIL — `['core']`만 반환(`local_linked` 누락). 둘째 테스트도 같은 이유로 FAIL. 기존 3건은 통과.

- [ ] **Step 3: 구현**

`src/infrastructure/workspace/moodle-root-resolver.ts`의 `safeReaddir`를 다음으로 교체하고 헬퍼 추가:

```ts
function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() || (d.isSymbolicLink() && statIsDirectory(path.join(dir, d.name))))
      .map(d => d.name);
  } catch { return []; }
}

/** 심볼릭 링크의 실제 대상이 디렉터리인지 — statSync는 링크를 따라가고, 깨진 링크는 throw → false */
function statIsDirectory(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); }
  catch { return false; }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx mocha test/unit/infra/resolver.test.ts`
Expected: PASS — 기존 3건 + 신규 2건 = 5건 녹색.

- [ ] **Step 5: 전체 회귀 확인**

Run: `npm run test:unit && npx tsc -noEmit`
Expected: 76건 전부 통과(74 + 2).

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/workspace/moodle-root-resolver.ts test/unit/infra/resolver.test.ts
git commit -m "fix(infra): 심볼릭 링크된 플러그인 디렉터리 색인 — symlink만 statSync로 확인"
```

---

### Task 2: 재발 방지 하드닝 — scopeContaining 구조적 유도 + 회귀 핀 2건

**Files:**
- Modify: `src/application/complete-record-columns.ts`
- Test: `test/unit/application/usecases.test.ts`, `test/unit/domain/inference.test.ts`

**Interfaces:**
- Consumes: `DocumentFacts`(6개 배열 필드, 원소 전부 `scope: Scope` 보유), 기존 유즈케이스 생성 패턴(`usecases.test.ts`의 `repo`/`TreeSitterPhpSyntax.create()`).
- Produces: `scopeContaining(facts: DocumentFacts, atIndex: number): Scope` — 동작 등가 리팩토링(기존 테스트가 보증).

- [ ] **Step 1: 회귀 핀 테스트 2건 작성 (둘 다 현재 코드로 녹색이어야 함)**

`test/unit/application/usecases.test.ts` 파일 끝에 추가 — `ValidateRecordColumns`는 이미 import되어 있음:

```ts
// 컬렉션 분리 E2E 음성 핀(백로그 12번): 도메인 테스트는 합성 팩트라 tree-sitter 추출이
// 표류하면 못 잡는다. 컬렉션 분리(965295a) 이전 코드라면 'foo' 진단 1건이 나와 실패했을 핀.
const CODE3 = `<?php
function h() {
  $rs = $DB->get_recordset('local_ubattend_config', ['id' => 1]);
  echo $rs->foo;
}
`;

describe('ValidateRecordColumns — 컬렉션 변수 음성 핀', () => {
  it('recordset 변수 프로퍼티 접근 → 진단 0건 (실파서 E2E)', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const uc = new ValidateRecordColumns(syn, repo, new RecordTypeInference());
    assert.equal(uc.run(CODE3).length, 0);
  });
});
```

`test/unit/domain/inference.test.ts`의 `get_records 직접 대입 → null` 테스트 바로 다음에 추가:

```ts
  it('get_records_select 직접 대입 → null (컬렉션 4개 대칭 커버)', () => {
    const f = { ...base,
      assignments: [{ varName: 'rows', receiver: 'DB', method: 'get_records_select', tableArg: 'user', index: 10, scope: S }],
      plainAssignments: [{ varName: 'rows', index: 10, scope: S }] };
    assert.equal(inf.infer(f, 'rows', 50, S, known), null);
  });
```

- [ ] **Step 2: 핀이 녹색인지 확인**

Run: `npx mocha test/unit/application/usecases.test.ts test/unit/domain/inference.test.ts`
Expected: PASS — 핀 2건 포함 전부 녹색 (핀은 회귀 방지용 — RED 단계 없음이 의도).

- [ ] **Step 3: scopeContaining 리팩토링**

`src/application/complete-record-columns.ts`:

1. import 변경(5행): `import { Scope } from '../domain/code-analysis/facts';` → `import { DocumentFacts, Scope } from '../domain/code-analysis/facts';`

2. `scopeContaining` 함수 전체(주석 포함)를 다음으로 교체:

```ts
// 커서 위치를 포함하는 가장 좁은 팩트 스코프(없으면 전체).
// DocumentFacts 전체에서 구조적으로 유도 — 새 팩트 종류가 추가돼도 자동 포함(수기 열거가 백로그 11번 버그의 원인).
function scopeContaining(facts: DocumentFacts, atIndex: number): Scope {
  let best: Scope = { start: 0, end: Number.MAX_SAFE_INTEGER };
  const all = (Object.values(facts).flat() as unknown[])
    .filter((x): x is { scope: Scope } => !!x && typeof x === 'object' && 'scope' in x);
  for (const { scope } of all)
    if (scope.start <= atIndex && atIndex <= scope.end && (scope.end - scope.start) < (best.end - best.start)) best = scope;
  return best;
}
```

- [ ] **Step 4: 등가성 확인 (기존 테스트 전부 녹색)**

Run: `npx mocha test/unit/application/usecases.test.ts`
Expected: PASS — 기존 클로저 정밀화 2건 + 양성 대조 + 신규 핀까지 전부 녹색 (리팩토링 등가성 검증).

- [ ] **Step 5: 전체 회귀 확인**

Run: `npm run test:unit && npx tsc -noEmit`
Expected: 78건 전부 통과(76 + 2).

- [ ] **Step 6: Commit**

```bash
git add src/application/complete-record-columns.ts test/unit/application/usecases.test.ts test/unit/domain/inference.test.ts
git commit -m "fix(app): scopeContaining을 DocumentFacts에서 구조적 유도 + 컬렉션 회귀 핀 2건"
```

---

### Task 3: 백로그 4·12번 완료 표시 + 최종 검증

**Files:**
- Modify: `docs/PHASE2-BACKLOG.md`

**Interfaces:**
- Consumes: Task 1·2 완료 상태 (코드 변경 없음).
- Produces: 갱신된 백로그.

- [ ] **Step 1: 백로그 4번 완료 표시**

`docs/PHASE2-BACKLOG.md`의 4번 항목(`4. **symlink 플러그인 디렉터리 색인**: …` 한 줄)을 다음으로 교체:

```markdown
4. ~~**symlink 플러그인 디렉터리 색인**~~ — ✅ 완료 (2026-08-04, 설계: `docs/superpowers/specs/2026-08-04-symlink-index-hardening-design.md`). 심볼릭 링크 엔트리만 statSync로 확인, 깨진 링크는 조용히 제외.
```

- [ ] **Step 2: 백로그 12번 완료 표시**

12번 항목(`12. **재발 방지 하드닝(2026-08-04 최종 리뷰)**: …` 한 줄)을 다음으로 교체:

```markdown
12. ~~**재발 방지 하드닝(2026-08-04 최종 리뷰)**~~ — ✅ 완료 (2026-08-04, 같은 설계 문서). scopeContaining 구조적 유도 + E2E 음성 핀 + get_records_select 핀.
```

- [ ] **Step 3: 최종 전체 검증**

Run: `npm run test:unit && npm run lint && npm run compile && npx tsc -p tsconfig.test.json`
Expected: 전부 통과 — 유닛 78건(74 기존 + 2 symlink + 2 핀), eslint, 프로덕션 번들, 테스트 컴파일.

- [ ] **Step 4: Commit**

```bash
git add docs/PHASE2-BACKLOG.md
git commit -m "docs: symlink 색인·하드닝 완료 반영 — 백로그 4·12번"
```
