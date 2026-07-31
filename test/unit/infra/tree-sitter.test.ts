import { strict as assert } from 'assert';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/tree-sitter/tree-sitter-php-syntax';

const CODE = `<?php
function process($cm) {
    $assign = $DB->get_record('assign', ['id' => 1]);
    $rows = $DB->get_records('local_ubattend_log', ['courseid' => 1]);
    foreach ($rows as $r) { echo $r->userid; }
    $data = new stdClass();
    $DB->insert_record('local_ubattend_config', $data);
    echo $assign->grade;
    /** @var \\stdClass $x */
    echo $x->foo;
}
`;

describe('TreeSitterPhpSyntax', () => {
  let syn: TreeSitterPhpSyntax; let f: any;
  before(async () => { syn = await TreeSitterPhpSyntax.create(); f = syn.facts(CODE); });

  it('assignment: $assign ← get_record(assign)', () => {
    const a = f.assignments.find((x: any) => x.varName === 'assign');
    assert.equal(a.method, 'get_record'); assert.equal(a.tableArg, 'assign');
  });
  it('assignment: $rows ← get_records(local_ubattend_log)', () => {
    const a = f.assignments.find((x: any) => x.varName === 'rows');
    assert.equal(a.method, 'get_records'); assert.equal(a.tableArg, 'local_ubattend_log');
  });
  it('foreach: rows→r', () => {
    const b = f.foreachBindings.find((x: any) => x.itemVar === 'r');
    assert.equal(b.collectionVar, 'rows');
  });
  it('property access: $assign->grade 위치정보', () => {
    const p = f.propertyAccesses.find((x: any) => x.varName === 'assign' && x.property === 'grade');
    assert.ok(p.propLine >= 0 && p.propIndex > 0);
  });
  it('dataArg: insert_record(local_ubattend_config, $data)', () => {
    const d = f.dataArgBindings.find((x: any) => x.dataVar === 'data');
    assert.equal(d.tableArg, 'local_ubattend_config'); assert.equal(d.method, 'insert_record');
  });
  it('phpdoc: @var stdClass $x', () => {
    const v = f.phpdocVars.find((x: any) => x.varName === 'x');
    assert.match(v.typeText, /stdClass/);
  });
  it('scope: 팩트가 함수 범위를 가진다', () => {
    assert.ok(f.assignments[0].scope.end > f.assignments[0].scope.start);
  });
});

// review 1 픽스: foreach key=>value / by-ref / key=>&value, dataArg read 제외 + 2번째 인자 앵커
const CODE2 = `<?php
function process2($cm) {
    foreach ($rows as $id => $record) { echo $record->id; }
    foreach ($items as &$ref) { echo $ref->id; }
    foreach ($pairs as $pk => &$pv) { echo $pv->id; }
    $params = ['courseid' => 1];
    $rec = $DB->get_record('t_read', $params);
    $DB->insert_record('t_write', $data);
    $DB->insert_record('t_write2', $data2, $extra);
}
`;

describe('TreeSitterPhpSyntax — review 1 fixes', () => {
  let syn: TreeSitterPhpSyntax; let f: any;
  before(async () => { syn = await TreeSitterPhpSyntax.create(); f = syn.facts(CODE2); });

  it('foreach $id => $record: itemVar은 value($record), key($id)는 무시', () => {
    const b = f.foreachBindings.find((x: any) => x.collectionVar === 'rows');
    assert.ok(b, 'rows에 대한 ForeachBinding이 있어야 한다');
    assert.equal(b.itemVar, 'record');
    assert.ok(!f.foreachBindings.some((x: any) => x.itemVar === 'id'), 'key 변수(id)는 itemVar로 바인딩되면 안 된다');
  });

  it('foreach &$ref (by-ref): itemVar은 ref', () => {
    const b = f.foreachBindings.find((x: any) => x.collectionVar === 'items');
    assert.ok(b, 'items에 대한 ForeachBinding이 있어야 한다');
    assert.equal(b.itemVar, 'ref');
  });

  it('foreach $pk => &$pv (key + by-ref value): itemVar은 pv, key(pk)는 무시', () => {
    const b = f.foreachBindings.find((x: any) => x.collectionVar === 'pairs');
    assert.ok(b, 'pairs에 대한 ForeachBinding이 있어야 한다');
    assert.equal(b.itemVar, 'pv');
    assert.ok(!f.foreachBindings.some((x: any) => x.itemVar === 'pk'), 'key 변수(pk)는 itemVar로 바인딩되면 안 된다');
  });

  it('dataArg: get_record(읽기)는 dataArgBinding을 만들지 않는다', () => {
    const d = f.dataArgBindings.find((x: any) => x.tableArg === 't_read');
    assert.equal(d, undefined);
  });

  it('dataArg: insert_record(t_write, $data) → dataVar는 data 하나만', () => {
    const matches = f.dataArgBindings.filter((x: any) => x.tableArg === 't_write');
    assert.equal(matches.length, 1);
    assert.equal(matches[0].dataVar, 'data');
    assert.equal(matches[0].method, 'insert_record');
  });

  it('dataArg: insert_record(t_write2, $data2, $extra) → dataVar는 data2 하나만(extra는 제외)', () => {
    const matches = f.dataArgBindings.filter((x: any) => x.tableArg === 't_write2');
    assert.equal(matches.length, 1);
    assert.equal(matches[0].dataVar, 'data2');
    assert.ok(!f.dataArgBindings.some((x: any) => x.dataVar === 'extra'));
  });
});

// kill-on-reassign: 일반 대입(plainAssignments) 추출 (스펙 2026-07-31)
const CODE3 = `<?php
function process3() {
    $a = build_row();
    $b = new stdClass();
    $c = $other;
    $d = 42;
    $e = $obj->fetch();
    $rec = $DB->get_record('user', ['id' => 1]);
    $rec->prop = 1;
    $fn = function () { $inner = 1; };
}
`;

describe('TreeSitterPhpSyntax — plainAssignments (kill-on-reassign)', () => {
  let syn: TreeSitterPhpSyntax; let f: any;
  before(async () => { syn = await TreeSitterPhpSyntax.create(); f = syn.facts(CODE3); });

  it('RHS 종류 무관 전부 캡처: func()/new/변수/리터럴/메서드콜', () => {
    for (const v of ['a', 'b', 'c', 'd', 'e']) {
      assert.ok(f.plainAssignments.some((x: any) => x.varName === v), `$${v} 캡처되어야 함`);
    }
  });
  it('프로퍼티 쓰기($rec->prop = 1)는 캡처하지 않음', () => {
    assert.ok(!f.plainAssignments.some((x: any) => x.varName === 'prop'));
    assert.equal(f.plainAssignments.filter((x: any) => x.varName === 'rec').length, 1,
      '$rec는 get_record 대입 1건만(프로퍼티 쓰기 줄은 제외)');
  });
  it('레코드 대입도 plainAssignments에 같은 index로 존재', () => {
    const ra = f.assignments.find((x: any) => x.varName === 'rec');
    assert.ok(f.plainAssignments.some((x: any) => x.varName === 'rec' && x.index === ra.index));
  });
  it('클로저 내부 대입의 scope는 클로저(외부와 분리)', () => {
    const inner = f.plainAssignments.find((x: any) => x.varName === 'inner');
    const outer = f.plainAssignments.find((x: any) => x.varName === 'a');
    assert.ok(inner, '$inner 캡처되어야 함');
    assert.ok(inner.scope.start > outer.scope.start, '클로저 scope가 함수 scope보다 안쪽이어야 함');
  });
});

// 최종 리뷰(2026-07-31): 문법 고정 — 복합/구조분해/참조 대입은 plainAssignments에 캡처되지 않음(낙관 동작).
// tree-sitter-wasms 업그레이드로 노드 형태가 바뀌면 이 테스트가 잡는다.
const CODE4 = `<?php
function process4() {
    $a = 1;
    $b += 2;
    $c ??= 3;
    $d .= 'x';
    [$e, $f] = [1, 2];
    list($g, $h) = [3, 4];
    $i =& $ref;
}
`;

describe('TreeSitterPhpSyntax — plainAssignments 문법 고정(비캡처 형태)', () => {
  let syn: TreeSitterPhpSyntax; let f: any;
  before(async () => { syn = await TreeSitterPhpSyntax.create(); f = syn.facts(CODE4); });

  it('단순 LHS 대입($a)만 캡처 — 복합(+=/??=/.=)·구조분해·참조(=&) 대입은 비캡처', () => {
    const names = f.plainAssignments.map((x: any) => x.varName).sort();
    assert.deepEqual(names, ['a']);
  });
});
