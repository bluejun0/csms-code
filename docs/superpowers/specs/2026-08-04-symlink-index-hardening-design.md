# CSMS Code — symlink 플러그인 색인 + 재발 방지 하드닝 설계

- **작성일**: 2026-08-04
- **작성자**: Claude (jun0@bluesoft.co.kr — "완성까지 알아서" 위임, 설계 결정은 Claude가 내리고 본 문서에 근거 기록)
- **상태**: 설계 확정 — 구현 계획 작성 단계
- **선행 문서**: `docs/PHASE2-BACKLOG.md` (4번·12번)

---

## 1. 배경과 목표

### 1a. symlink 플러그인 미색인 (백로그 4번)
`moodle-root-resolver.ts`의 `safeReaddir`가 `Dirent.isDirectory()`로 필터링한다. `Dirent.isDirectory()`는
**심볼릭 링크를 따라가지 않으므로** 링크된 플러그인 디렉터리(예: 개발 중 `local/coursemos → ~/dev/coursemos`)가
열거에서 탈락해 그 플러그인의 install.xml 테이블이 색인되지 않는다.

**결정**: 일반 디렉터리는 기존 Dirent 빠른 경로 유지, **심볼릭 링크 엔트리만** `fs.statSync`(링크를 따라감)로
대상이 디렉터리인지 확인. 깨진 링크는 statSync가 throw → 조용히 제외(크래시 금지). 모든 엔트리를
statSync하는 방안은 대형 디렉터리에서 불필요한 syscall이라 기각.

### 1b. 재발 방지 하드닝 (백로그 12번, 2026-08-04 최종 리뷰 신설)
1. **`scopeContaining` 구조적 유도**: 파라미터를 수기 열거 인라인 타입 대신 `DocumentFacts`로 받고,
   후보를 `Object.values(facts).flat()`으로 유도. 수기 열거는 팩트 종류가 늘 때 누락되는 구조였고
   (11번 버그의 원인), 구조적 유도는 새 팩트 종류를 자동 포함한다. 방어: scope 없는 원소가 섞여도
   크래시하지 않도록 타입 가드 필터.
2. **컬렉션 분리 E2E 음성 핀**: `$rs = $DB->get_recordset(…); echo $rs->foo;`가 **실파서 경유**로
   진단 0건 — 도메인 테스트는 합성 팩트라 tree-sitter 추출이 표류해도 못 잡는 이음새를 닫는다.
3. **`get_records_select` 직접 대입 → null 도메인 핀** (컬렉션 4개 중 유일하게 미커버).

### 비목표(YAGNI)
- 중첩 symlink 체인·순환 링크 특수 처리 — statSync가 자연 처리(순환은 ELOOP throw → 제외).
- 색인 watcher의 symlink 대상 변경 감지 — 기존 watcher 동작 범위 밖.

---

## 2. 변경 상세

### 2.1 `safeReaddir` (moodle-root-resolver.ts)
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

### 2.2 `scopeContaining` (complete-record-columns.ts)
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
import에 `DocumentFacts` 추가. 선택 로직(최소 스코프)·호출부 무변경 — 순수 리팩토링이므로 기존
클로저 테스트 2건 + 양성 대조가 등가성을 보증한다.

## 3. 테스트 전략

**인프라** (`resolver.test.ts` 추가 2건): 런타임 tmp 픽스처(`fs.mkdtempSync(os.tmpdir())`, after에서 정리 —
커밋된 symlink는 Windows 체크아웃을 깨므로 기각)에 version.php + lib/db/install.xml + `local/linked →
target(외부 디렉터리, db/install.xml 보유)` 구성. ① 링크된 플러그인이 `local_linked`로 열거 ② 깨진 링크
추가 후에도 결과 동일·크래시 없음. RED: 현재 코드는 `local_linked` 누락.

**애플리케이션·도메인 핀** (§1b-2·3): E2E 음성(usecases.test.ts) 1건 + `get_records_select` 도메인(inference.test.ts) 1건.
둘 다 현재 코드로 녹색인 회귀 핀 — E2E 핀은 컬렉션 분리(965295a) 이전 코드라면 진단 1건이 나와 실패했을
판별력 있는 핀임을 명시. `scopeContaining` 리팩토링은 기존 테스트 무변경 녹색이 검증.

## 4. 성공 기준
- 신규 4건 + 기존 74건 = 78건 전부 녹색, lint/compile/test-tsc 통과.
- 백로그 4번·12번 완료 표시.
