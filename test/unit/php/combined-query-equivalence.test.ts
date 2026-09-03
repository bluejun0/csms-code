import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { FragmentSet } from '../../../src/infrastructure/php/fragment-set';
import { PhpRuntime } from '../../../src/infrastructure/php/tree-sitter-runtime';
import { ScopeTable } from '../../../src/infrastructure/php/scope-table';
import { ALL_FRAGMENTS as FRAGMENTS } from '../../../src/infrastructure/php/php-syntax';

// 조각이 늘거나 줄면 곧바로 실패시켜 아래 EXPECTED_COVERED_FRAGMENTS도 같이 다시
// 측정하게 만든다 — 조각 배열이 비어도(또는 일부가 늘어도) 초록불이 나오는 일을 막는다.
const EXPECTED_FRAGMENT_COUNT = 29;

// 픽스처가 실제로 매치를 만들어주는 조각 인덱스(측정값). 이 목록에 없는 인덱스는
// 픽스처로는 인덱스 밀림을 잡아낼 수 없다는 뜻이다 — 커버리지를 늘리려고 픽스처를
// 추가하지 말고, 실제로 늘었을 때만 다시 측정해서 갱신한다.
const EXPECTED_COVERED_FRAGMENTS = [6, 7, 8, 9, 10, 11, 12, 13, 18, 21, 23, 25, 27, 28];

function fixturePhpFiles(): string[] {
  const root = path.join(__dirname, '../../fixtures');
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.name.endsWith('.php')) out.push(p);
    }
  };
  walk(root);
  return out;
}

function corpusPhpFiles(limit: number): { files: string[]; dirErrors: number } {
  const root = process.env.CSMS_CORPUS;
  if (!root || !fs.existsSync(root)) return { files: [], dirErrors: 0 };
  const out: string[] = [];
  let dirErrors = 0;
  const walk = (dir: string) => {
    if (out.length >= limit) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { dirErrors++; return; }
    for (const d of entries) {
      if (out.length >= limit) return;
      if (d.name === 'node_modules' || d.name === '.git' || d.name === 'vendor') continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.name.endsWith('.php') && fs.statSync(p).size < 200_000) out.push(p);
    }
  };
  walk(root);
  return { files: out, dirErrors };
}

describe('통합 쿼리 등가성', () => {
  let runtime: PhpRuntime;
  let combined: ReturnType<PhpRuntime['compile']>;
  let singles: ReturnType<PhpRuntime['compile']>[];

  before(async () => {
    runtime = await PhpRuntime.create();
    combined = runtime.compile(FragmentSet.of(FRAGMENTS).source);
    singles = FRAGMENTS.map(f => runtime.compile(f.pattern));
  });

  // 파일 하나를 검사한다. 파싱에 성공하면 조각별 매치 수를 onMatch로 흘려보내고
  // true를, 파싱 실패면 false를 돌려준다 — 호출부가 파싱 성공 개수를 셀 수 있게.
  const check = (file: string, onMatch?: (patternIndex: number) => void): boolean => {
    const text = fs.readFileSync(file, 'utf8');
    const doc = runtime.parse(text);
    if (!doc) return false;
    try {
      const scopes = ScopeTable.of([], doc.endIndex);
      const byPattern = new Map<number, number>();
      for (const m of doc.run(combined, scopes)) {
        byPattern.set(m.patternIndex, (byPattern.get(m.patternIndex) ?? 0) + 1);
        onMatch?.(m.patternIndex);
      }
      singles.forEach((single, i) => {
        const alone = [...doc.run(single, scopes)].length;
        assert.equal(byPattern.get(i) ?? 0, alone, `${path.basename(file)} 조각 ${i}`);
      });
    } finally {
      doc.dispose();
    }
    return true;
  };

  it('조각 개수가 고정값과 같다', () => {
    assert.equal(FRAGMENTS.length, EXPECTED_FRAGMENT_COUNT);
  });

  it('픽스처 PHP 파일에서 패턴별 매치 수가 같다', () => {
    const files = fixturePhpFiles();
    assert.ok(files.length > 0);
    const totals = new Array(FRAGMENTS.length).fill(0);
    files.forEach(file => check(file, i => { totals[i]++; }));

    const covered = totals.flatMap((t, i) => (t > 0 ? [i] : []));
    const uncovered = totals.flatMap((t, i) => (t === 0 ? [i] : []));
    assert.deepEqual(covered, EXPECTED_COVERED_FRAGMENTS,
      `픽스처가 매치를 만들지 않는 조각: ${uncovered.join(', ')} — 이 조각들은 인덱스가 밀려도 이 테스트로 못 잡는다`);
  });

  it('코퍼스 PHP 파일에서 패턴별 매치 수가 같다', function () {
    const limit = 300;
    const { files, dirErrors } = corpusPhpFiles(limit);
    if (files.length === 0) this.skip();
    let parsed = 0;
    files.forEach(file => { if (check(file)) parsed++; });
    assert.equal(dirErrors, 0, '디렉터리 순회 중 읽기 실패가 있었다 — 코퍼스 일부가 조용히 빠졌을 수 있다');
    assert.equal(parsed, files.length,
      `${files.length}개 중 ${files.length - parsed}개가 파싱에 실패해 비교 없이 빠졌다`);
  });
});
