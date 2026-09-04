import { strict as assert } from 'assert';
import { accessFragments } from '../../../src/infrastructure/php/fragments/access';
import { FragmentSet } from '../../../src/infrastructure/php/fragment-set';
import { PhpRuntime } from '../../../src/infrastructure/php/tree-sitter-runtime';
import { ScopeTable } from '../../../src/infrastructure/php/scope-table';
import { DocumentFacts, emptyFacts } from '../../../src/domain/code-analysis/facts';

const CODE = `<?php
/** @var local_x_table $rec */
$rec = null;
echo $rec->userid;
$DB->get_record('user', []);
$note = "@var fake_table $ghost";
`;

async function factsOf(): Promise<DocumentFacts> {
  const runtime = await PhpRuntime.create();
  const set = FragmentSet.of(accessFragments);
  const query = runtime.compile(set.source);
  const doc = runtime.parse(CODE)!;
  const facts = emptyFacts();
  set.collect(doc.run(query, ScopeTable.of(doc.scopeRanges(), doc.endIndex)),
    { add: (kind, fact) => { (facts[kind] as unknown[]).push(fact); } });
  doc.dispose();
  return facts;
}

describe('accessFragments', () => {
  let f: DocumentFacts;
  before(async () => { f = await factsOf(); });

  it('프로퍼티 접근의 이름 위치를 담는다', () => {
    const p = f.propertyAccesses.find(x => x.varName === 'rec' && x.property === 'userid')!;
    assert.equal(p.propLine, 3);
    assert.ok(p.propIndex > p.index);
  });
  it('메서드 호출을 담는다', () => {
    assert.ok(f.methodCalls.some(x => x.varName === 'DB' && x.method === 'get_record'));
  });
  it('주석의 @var를 담는다', () => {
    const v = f.phpdocVars.find(x => x.varName === 'rec')!;
    assert.equal(v.typeText, 'local_x_table');
  });
  it('주석 밖 문자열의 @var는 담지 않는다', () => {
    assert.ok(!f.phpdocVars.some(x => x.varName === 'ghost'));
  });
  it('@var의 index는 주석 노드의 시작이다', () => {
    const v = f.phpdocVars.find(x => x.varName === 'rec')!;
    assert.equal(CODE.slice(v.index, v.index + 3), '/**');
  });
});
