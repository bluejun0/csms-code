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
      ['local_a', 'local_b', 'local_c']);
  });
  it('여러 줄 문자열에서 줄·컬럼이 문서 기준이다', () => {
    const b = f.tableRefs.find(r => r.name === 'local_b')!;
    assert.equal(b.nameLine, 3);
    assert.equal(CODE.slice(b.nameIndex, b.nameIndex + 7), 'local_b');
  });
  it('sql_ 접두 메서드의 첫 인자는 테이블이 아니다', () => {
    assert.ok(!f.tableRefs.some(r => r.name === 'col'));
  });
});
