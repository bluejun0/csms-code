import { strict as assert } from 'assert';
import { tableFragments } from '../../../src/infrastructure/php/fragments/tables';
import { FragmentSet } from '../../../src/infrastructure/php/fragment-set';
import { PhpRuntime } from '../../../src/infrastructure/php/tree-sitter-runtime';
import { ScopeTable } from '../../../src/infrastructure/php/scope-table';
import { DocumentFacts, emptyFacts } from '../../../src/domain/code-analysis/facts';

const CODE = `<?php
$sql = "SELECT *
  FROM {local_a} a
  JOIN {local_b} b ON a.id = b.aid";
$DB->update_record('local_c', $x);
$DB->sql_like('col', '?');
$q = 'SELECT * FROM {local_first} WHERE id = ?';
$nd = <<<'SQL'
SELECT * FROM {local_nowdoc}
SQL;
`;

async function factsOf(): Promise<DocumentFacts> {
  const runtime = await PhpRuntime.create();
  const set = FragmentSet.of(tableFragments);
  const query = runtime.compile(set.source);
  const doc = runtime.parse(CODE)!;
  const facts = emptyFacts();
  set.collect(doc.run(query, ScopeTable.of(doc.scopeRanges(), doc.endIndex)),
    { add: (kind, fact) => { (facts[kind] as unknown[]).push(fact); } });
  doc.dispose();
  return facts;
}

describe('tableFragments', () => {
  let f: DocumentFacts;
  before(async () => { f = await factsOf(); });

  it('SQL 중괄호 참조를 담는다', () => {
    assert.deepEqual(f.tableRefs.filter(r => r.name.startsWith('local_')).map(r => r.name).sort(),
      ['local_a', 'local_b', 'local_c', 'local_first', 'local_nowdoc']);
  });
  it('여러 줄 문자열에서 줄·컬럼이 문서 기준이다', () => {
    const b = f.tableRefs.find(r => r.name === 'local_b')!;
    assert.equal(b.nameLine, 3);
    assert.equal(CODE.slice(b.nameIndex, b.nameIndex + 7), 'local_b');
  });
  it('sql_ 접두 메서드의 첫 인자는 테이블이 아니다', () => {
    assert.ok(!f.tableRefs.some(r => r.name === 'col'));
  });
  it('문자열 노드의 첫 줄(개행 이전)에서도 컬럼이 문서 기준이다', () => {
    // local_first는 문자열이 시작하는 바로 그 줄에 있다 — lineStart를 노드 시작 컬럼의 음수로
    // 초기화하는 분기(줄바꿈을 아직 한 번도 못 만난 상태)를 검증한다.
    const first = f.tableRefs.find(r => r.name === 'local_first')!;
    const lines = CODE.split('\n');
    const lineIndex = lines.findIndex(l => l.includes('local_first'));
    assert.equal(first.nameLine, lineIndex);
    assert.equal(first.nameColumn, lines[lineIndex].indexOf('local_first'));
  });
  it('nowdoc 본문의 중괄호 참조도 담는다', () => {
    assert.ok(f.tableRefs.some(r => r.name === 'local_nowdoc'));
  });
});
