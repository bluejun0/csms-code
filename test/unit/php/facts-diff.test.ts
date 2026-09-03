import { strict as assert } from 'assert';
import { compareOverFiles, compareOverFilesDetailed, diffFacts, FactKind } from '../../tools/facts-diff';
import { emptyFacts } from '../../../src/domain/code-analysis/facts';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/php/php-syntax';
import { TreeSitterPhpSyntax as LegacyPhpSyntax } from '../../../src/infrastructure/tree-sitter/tree-sitter-php-syntax';
import { PhpRuntime } from '../../../src/infrastructure/php/tree-sitter-runtime';
import * as fs from 'fs';
import * as path from 'path';

// 코퍼스 테스트 전용 — 환경변수가 없으면 빈 목록을 돌려줘 호출부가 스킵하게 한다.
// combined-query-equivalence.test.ts의 같은 이름 함수와 동일한 규약이다.
function corpusPhpFiles(limit: number): string[] {
  const root = process.env.CSMS_CORPUS;
  if (!root || !fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    if (out.length >= limit) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of entries) {
      if (out.length >= limit) return;
      if (d.name === 'node_modules' || d.name === '.git' || d.name === 'vendor') continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.name.endsWith('.php') && fs.statSync(p).size < 200_000) out.push(p);
    }
  };
  walk(root);
  return out;
}

describe('facts-diff', () => {
  it('순서만 다른 팩트는 차이가 아니다', () => {
    const a = emptyFacts(); const b = emptyFacts();
    a.tableRefs.push({ name: 'x', nameLine: 1, nameColumn: 0, nameIndex: 10 });
    a.tableRefs.push({ name: 'y', nameLine: 2, nameColumn: 0, nameIndex: 20 });
    b.tableRefs.push({ name: 'y', nameLine: 2, nameColumn: 0, nameIndex: 20 });
    b.tableRefs.push({ name: 'x', nameLine: 1, nameColumn: 0, nameIndex: 10 });
    assert.deepEqual(diffFacts(a, b), []);
  });

  it('스코프만 달라도 차이로 잡는다', () => {
    const a = emptyFacts(); const b = emptyFacts();
    a.plainAssignments.push({ varName: 'x', index: 5, scope: { start: 0, end: 100 } });
    b.plainAssignments.push({ varName: 'x', index: 5, scope: { start: 0, end: 200 } });
    assert.equal(diffFacts(a, b).length, 1);
  });

  it('값이 다르면 차이로 잡는다', () => {
    const a = emptyFacts(); const b = emptyFacts();
    a.tableRefs.push({ name: 'x', nameLine: 1, nameColumn: 0, nameIndex: 10 });
    const d = diffFacts(a, b);
    assert.equal(d.length, 1);
    assert.equal(d[0].kind, 'tableRefs');
  });

  it('픽스처 전체에서 옛 구현과 새 구현의 팩트가 같다', async () => {
    const [legacy, next] = await Promise.all([LegacyPhpSyntax.create(), TreeSitterPhpSyntax.create()]);
    const root = path.join(__dirname, '../../fixtures');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) walk(p); else if (d.name.endsWith('.php')) files.push(p);
      }
    };
    walk(root);
    // 픽스처가 비거나 전부 파싱 실패하면 아래 diff는 파일 0개를 비교하고도 조용히
    // 통과한다 — 그 공허한 통과를 막기 위해 실제로 팩트가 나왔는지까지 확인한다.
    assert.ok(files.length > 0, '픽스처 PHP 파일이 없다');
    const totalFacts = files.reduce(
      (sum, file) => sum + Object.values(legacy.facts(fs.readFileSync(file, 'utf8'))).reduce((n, list) => n + list.length, 0),
      0,
    );
    assert.ok(totalFacts > 0, '픽스처에서 팩트가 하나도 안 나왔다');
    const differences = compareOverFiles(legacy, next, files);
    assert.deepEqual([...differences.keys()], []);
  });

  // CSMS_CORPUS가 없으면 스킵한다 — combined-query-equivalence.test.ts의 코퍼스 테스트와
  // 같은 규약. "차이 0개"라는 주장의 근거를 코드로 재현 가능하게 남겨, 지운 임시
  // 스크립트가 아니라 이 테스트를 다시 돌리는 것만으로 같은 증거를 다시 얻을 수 있게 한다.
  it('코퍼스 전체에서 옛 구현과 새 구현의 팩트가 같다', async function () {
    const files = corpusPhpFiles(2000);
    if (files.length === 0) this.skip();

    const [legacy, next] = await Promise.all([LegacyPhpSyntax.create(), TreeSitterPhpSyntax.create()]);
    const runtime = await PhpRuntime.create();

    const { differences, stats } = compareOverFilesDetailed(legacy, next, files);

    // 읽기 실패로 조용히 빠진 파일이 있으면 "N개 비교"라는 주장 자체가 거짓이 된다.
    assert.equal(stats.skipped, 0, `읽기 실패로 ${stats.skipped}개가 비교 없이 빠졌다`);
    assert.equal(stats.compared, files.length, '찾은 파일 수와 실제로 비교한 파일 수가 다르다');

    assert.deepEqual([...differences.keys()], []);

    // 조각별 합계 집계 + 새 구현이 조용히 파싱에 실패한 파일 추적을 한 번의 순회로 같이 한다.
    const kindTotals = new Map<FactKind, [number, number]>();
    const emptyKeys = Object.keys(emptyFacts()) as FactKind[];
    for (const kind of emptyKeys) kindTotals.set(kind, [0, 0]);
    const newFailed = new Set<string>();
    const legacyWarned = new Set<string>();
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');

      const doc = runtime.parse(text);
      if (!doc) newFailed.add(file); else doc.dispose();

      const originalWarn = console.warn;
      let warned = false;
      console.warn = () => { warned = true; };
      const legacyFacts = legacy.facts(text) as unknown as Record<FactKind, unknown[]>;
      console.warn = originalWarn;
      if (warned) legacyWarned.add(file);

      const nextFacts = next.facts(text) as unknown as Record<FactKind, unknown[]>;
      for (const kind of emptyKeys) {
        const totals = kindTotals.get(kind)!;
        totals[0] += legacyFacts[kind].length;
        totals[1] += nextFacts[kind].length;
      }
    }

    // 팩트 조각 17종 전부가 코퍼스에서 실제로 최소 한 번은 나와야 한다 — 그렇지 않은 종류는
    // "차이 0개"라는 결과가 그 종류에 대해서는 아무것도 증명하지 못한다는 뜻이다.
    const untouched = emptyKeys.filter(kind => {
      const [l, n] = kindTotals.get(kind)!;
      return l === 0 && n === 0;
    });
    assert.deepEqual(untouched, [], `코퍼스에서 한 번도 안 나온 팩트 종류: ${untouched.join(', ')}`);

    // 옛 구현이 경고를 낸 파일(파싱 실패)과 새 구현이 null을 돌려준 파일(파싱 실패)의
    // 집합이 정확히 같아야 한다 — 한쪽만 실패하면 "차이 없음"이 실제로는 비교하지
    // 못한 파일을 놓친 것일 수 있다.
    const onlyNew = [...newFailed].filter(f => !legacyWarned.has(f));
    const onlyLegacy = [...legacyWarned].filter(f => !newFailed.has(f));
    assert.deepEqual(onlyNew, [], '새 구현에서만 파싱이 실패한 파일이 있다 — 한쪽만 실패한 파일은 비교되지 않았을 수 있다');
    assert.deepEqual(onlyLegacy, [], '옛 구현에서만 파싱이 실패한 파일이 있다');
  });
});
