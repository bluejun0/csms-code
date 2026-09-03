import { strict as assert } from 'assert';
import { recordFragments } from '../../../src/infrastructure/php/fragments/record';
import { FragmentSet } from '../../../src/infrastructure/php/fragment-set';
import { PhpRuntime } from '../../../src/infrastructure/php/tree-sitter-runtime';
import { ScopeTable } from '../../../src/infrastructure/php/scope-table';
import { DocumentFacts, emptyFacts } from '../../../src/domain/code-analysis/facts';

const CODE = `<?php
function f() {
  $rec = $DB->get_record('assign', ['id' => 1]);
  $rows = $DB->get_records('local_log', []);
  foreach ($rows as $r) { echo $r->id; }
  foreach ($rows as $k => &$v) { echo $v->id; }
  $DB->insert_record('local_cfg', $data);
  $rec = build();
}`;

async function factsOf(): Promise<DocumentFacts> {
  const runtime = await PhpRuntime.create();
  const set = FragmentSet.of(recordFragments);
  const query = runtime.compile(set.source);
  const doc = runtime.parse(CODE)!;
  const facts = emptyFacts();
  set.collect(doc.run(query, ScopeTable.of(doc.scopeRanges(), doc.endIndex)),
    { add: (kind, fact) => { (facts[kind] as unknown[]).push(fact); } });
  doc.dispose();
  return facts;
}

describe('recordFragments', () => {
  let f: DocumentFacts;
  before(async () => { f = await factsOf(); });

  it('테이블 인자가 있는 대입', () => {
    const a = f.assignments.find(x => x.varName === 'rec' && x.tableArg === 'assign')!;
    assert.equal(a.method, 'get_record');
    assert.equal(a.receiver, 'DB');
  });
  it('foreach 단순 형태', () => {
    const b = f.foreachBindings.find(x => x.itemVar === 'r')!;
    assert.equal(b.collectionVar, 'rows');
  });
  it('foreach key=>&value 형태의 값 변수만 담는다', () => {
    assert.ok(f.foreachBindings.some(x => x.itemVar === 'v'));
    assert.ok(!f.foreachBindings.some(x => x.itemVar === 'k'));
  });
  it('쓰기 메서드의 데이터 인자', () => {
    const d = f.dataArgBindings.find(x => x.dataVar === 'data')!;
    assert.equal(d.tableArg, 'local_cfg');
    assert.equal(d.method, 'insert_record');
  });
  it('일반 대입은 재대입 추적을 위해 모두 담는다', () => {
    assert.equal(f.plainAssignments.filter(x => x.varName === 'rec').length, 2);
  });
  it('함수 스코프가 문서 전체가 아니다', () => {
    const a = f.assignments.find(x => x.varName === 'rec')!;
    assert.ok(a.scope.start > 0);
  });
});
