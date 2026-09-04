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

// 문법 고정 — 복합(+=/??=/.=)·구조분해([$e,$f]=/list()=)·참조(=&) 대입은
// plainAssignments의 grammar 패턴(assignment_expression left: (variable_name))에
// 매칭되지 않는다는 tree-sitter grammar 사실을 고정한다. 확장 로직이 아니라
// grammar 업그레이드로 이 형태가 바뀌면 이 테스트가 잡는다.
const CODE_GRAMMAR_PIN = `<?php
function g() {
  $a = 1;
  $b += 2;
  $c ??= 3;
  $d .= 'x';
  [$e, $f] = [1, 2];
  list($g, $h) = [3, 4];
  $i =& $ref;
}`;

async function factsOf(code: string = CODE): Promise<DocumentFacts> {
  const runtime = await PhpRuntime.create();
  const set = FragmentSet.of(recordFragments);
  const query = runtime.compile(set.source);
  const doc = runtime.parse(code)!;
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

describe('recordFragments — plainAssignments 문법 고정(비캡처 형태)', () => {
  let f: DocumentFacts;
  before(async () => { f = await factsOf(CODE_GRAMMAR_PIN); });

  it('단순 LHS 대입($a)만 캡처 — 복합·구조분해·참조 대입은 비캡처', () => {
    const names = f.plainAssignments.map(x => x.varName).sort();
    assert.deepEqual(names, ['a'],
      '$b(+=)·$c(??=)·$d(.=)·$e/$f(구조분해 [])·$g/$h(구조분해 list())·$i(참조 =&) 중 하나라도 섞이면 grammar 노드 형태가 바뀐 것');
  });
});
