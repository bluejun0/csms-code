import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { FragmentSet } from '../../../src/infrastructure/php/fragment-set';
import { PhpRuntime } from '../../../src/infrastructure/php/tree-sitter-runtime';
import { ScopeTable } from '../../../src/infrastructure/php/scope-table';
import { ALL_FRAGMENTS as FRAGMENTS } from '../../../src/infrastructure/php/php-syntax';

// 조각이 늘거나 줄면 곧바로 실패시켜 커버리지 전제도 다시 살펴보게 만든다 — 조각
// 배열이 비어도(또는 일부가 늘어도) 초록불이 나오는 일을 막는다.
const EXPECTED_FRAGMENT_COUNT = 29;

// 픽스처 트리에는 없는 구성만 모았다 — $DB 대입 두 형태(테이블 인자 있음/없음), foreach
// 네 형태, new 한 인자 문자열 호출, 동적 컴포넌트 세 형태(변수·$this 프로퍼티·클래스 상수),
// 문자열 기본값을 가진 프로퍼티·const 선언, 리터럴/동적 플러그인 set_config, {table} 참조가
// 있는 nowdoc. 공유 픽스처 트리에 넣으면 다른 테스트의 매치 수가 흔들리므로 여기 인라인으로 둔다.
const SUPPLEMENTAL_PHP_SOURCE = `<?php
function f() {
  $rec = $DB->get_record('mytable');
  $other = $DB->get_record_sql($sql);
  foreach ($items as $item) { echo $item; }
  foreach ($items as $key => $item2) { echo $key . $item2; }
  foreach ($items as &$item3) { $item3 = 1; }
  foreach ($items as $key2 => &$item4) { $item4 = 2; }
  throw new moodle_exception('onlykey');
  echo get_string('dynkey1', $component);
  set_config('setkey1', 1, 'local_plugin');
  set_config('setkey2', 1, $plugin);
}

class SampleFixture {
  public $component = 'local_sample';
  const COMPONENT = 'core_sample';

  function g() {
    echo get_string('dynkey2', $this->component);
    echo get_string('dynkey3', self::COMPONENT);
  }
}

$nd = <<<'SQL'
SELECT * FROM {sample_table}
SQL;
`;

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

  // 소스 하나를 검사한다. 파싱에 성공하면 조각별 매치 수를 onMatch로 흘려보내고
  // true를, 파싱 실패면 false를 돌려준다 — 호출부가 파싱 성공 개수를 셀 수 있게.
  const check = (label: string, text: string, onMatch?: (patternIndex: number) => void): boolean => {
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
        assert.equal(byPattern.get(i) ?? 0, alone, `${label} 조각 ${i}`);
      });
    } finally {
      doc.dispose();
    }
    return true;
  };

  const checkFile = (file: string, onMatch?: (patternIndex: number) => void): boolean =>
    check(path.basename(file), fs.readFileSync(file, 'utf8'), onMatch);

  it('조각 개수가 고정값과 같다', () => {
    assert.equal(FRAGMENTS.length, EXPECTED_FRAGMENT_COUNT);
  });

  it('픽스처 PHP 파일에서 패턴별 매치 수가 같다', () => {
    const files = fixturePhpFiles();
    assert.ok(files.length > 0);
    const parsed = files.filter(file => checkFile(file)).length;
    assert.equal(parsed, files.length,
      `${files.length}개 중 ${files.length - parsed}개가 파싱에 실패해 비교 없이 빠졌다`);
  });

  // 픽스처 테스트와 별개로 다시 훑는다 — --grep이나 .only로 이 테스트만 돌려도
  // 커버리지 판정이 그 자체로 성립해야 한다. 파일 몇십 개 재파싱은 무시할 비용이다.
  it('픽스처가 다루지 않는 조각을 인라인 소스로 보강한다', () => {
    const files = fixturePhpFiles();
    assert.ok(files.length > 0);
    const totals = new Array(FRAGMENTS.length).fill(0);
    files.forEach(file => checkFile(file, i => { totals[i]++; }));
    assert.ok(check('보강 소스', SUPPLEMENTAL_PHP_SOURCE, i => { totals[i]++; }), '보강 소스가 파싱에 실패했다');
    const uncovered = totals.flatMap((t, i) => (t === 0 ? [i] : []));
    assert.deepEqual(uncovered, [], `픽스처+보강 소스로도 매치가 없는 조각: ${uncovered.join(', ')}`);
  });

  it('코퍼스 PHP 파일에서 패턴별 매치 수가 같다', function () {
    const limit = 300;
    const { files, dirErrors } = corpusPhpFiles(limit);
    if (files.length === 0) this.skip();
    let parsed = 0;
    files.forEach(file => { if (checkFile(file)) parsed++; });
    assert.equal(dirErrors, 0, '디렉터리 순회 중 읽기 실패가 있었다 — 코퍼스 일부가 조용히 빠졌을 수 있다');
    assert.equal(parsed, files.length,
      `${files.length}개 중 ${files.length - parsed}개가 파싱에 실패해 비교 없이 빠졌다`);
  });
});
