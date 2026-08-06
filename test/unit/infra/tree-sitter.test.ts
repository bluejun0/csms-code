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

// Plan 2: get_string 리터럴 호출 추출 (스펙 2026-08-04)
const CODE5 = `<?php
function s() {
    $t = get_string('attendance_book', 'local_ubattend');
    $u = get_string('attemptnum', 'local_ubattend', $count);
    $v = get_string($dynamic, 'local_ubattend');
    $w = other_string('not_me', 'local_ubattend');
}
`;

describe('TreeSitterPhpSyntax — stringCalls (get_string)', () => {
  let syn: TreeSitterPhpSyntax; let f: any;
  before(async () => { syn = await TreeSitterPhpSyntax.create(); f = syn.facts(CODE5); });

  it('리터럴 key/component 추출 + key 위치 정확성', () => {
    const c = f.stringCalls.find((x: any) => x.key === 'attendance_book');
    assert.ok(c, 'attendance_book 호출이 추출되어야 함');
    assert.equal(c.component, 'local_ubattend');
    assert.equal(CODE5.slice(c.keyIndex, c.keyIndex + c.key.length), 'attendance_book');
    assert.ok(c.keyLine === 2 && c.keyColumn > 0);
  });
  it('3번째 인자($a)가 있어도 추출', () => {
    assert.ok(f.stringCalls.some((x: any) => x.key === 'attemptnum'));
  });
  it('변수 키는 비추출(자연 침묵)', () => {
    assert.equal(f.stringCalls.filter((x: any) => x.component === 'local_ubattend').length, 2);
  });
  it('get_string 아닌 함수는 제외', () => {
    assert.ok(!f.stringCalls.some((x: any) => x.key === 'not_me'));
  });
});

// Mustache: render_from_template 리터럴 호출 (스펙 2026-08-05)
const CODE6 = `<?php
function r() {
    echo $OUTPUT->render_from_template('local_ubattend/setting', $data);
    echo $this->render_from_template('local_ubattend/svg/icon/hyflex', []);
    echo $renderer->render_from_template('theme_coursemos/own', []);
    echo $OUTPUT->render_from_template($dynamic, []);
    echo $OUTPUT->other_method('local_ubattend/nope', []);
}
`;

describe('TreeSitterPhpSyntax — templateCalls (render_from_template)', () => {
  let syn: TreeSitterPhpSyntax; let f: any;
  before(async () => { syn = await TreeSitterPhpSyntax.create(); f = syn.facts(CODE6); });

  it('수신자 무관 추출($OUTPUT/$this/기타) — 3건', () => {
    const refs = f.templateCalls.map((x: any) => x.ref).sort();
    assert.deepEqual(refs, ['local_ubattend/setting', 'local_ubattend/svg/icon/hyflex', 'theme_coursemos/own']);
  });
  it('ref 위치 정확성', () => {
    const c = f.templateCalls.find((x: any) => x.ref === 'local_ubattend/setting');
    assert.equal(CODE6.slice(c.refIndex, c.refIndex + c.ref.length), 'local_ubattend/setting');
    assert.equal(c.refLine, 2);
  });
  it('동적 인자·다른 메서드는 비추출', () => {
    assert.ok(!f.templateCalls.some((x: any) => x.ref === 'local_ubattend/nope'));
    assert.equal(f.templateCalls.length, 3);
  });
});

// SQL 문자열 안의 {table} 참조 — 인용 방식 네 가지와 위치 계산
const CODE7 = `<?php
$a = 'SELECT * FROM {course} WHERE id = ?';
$b = "SELECT * FROM {user} u JOIN {course_modules} cm WHERE x = {$id}";
$c = <<<SQL
SELECT *
  FROM {grade_items} gi
 WHERE gi.id = ?
SQL;
$d = <<<'RAW'
FROM {assign}
RAW;
$e = '/[0-9]{4}/';
`;

describe('TreeSitterPhpSyntax — tableRefs (SQL {table})', () => {
  let syn: TreeSitterPhpSyntax; let f: any;
  before(async () => { syn = await TreeSitterPhpSyntax.create(); f = syn.facts(CODE7); });

  it('단일 인용·이중 인용·heredoc·nowdoc 모두에서 뽑는다', () => {
    assert.deepEqual(f.tableRefs.map((r: any) => r.name),
      ['course', 'user', 'course_modules', 'grade_items', 'assign', '4']);
  });

  it('보간 {$var}는 이름으로 잡지 않는다', () => {
    assert.ok(!f.tableRefs.some((r: any) => r.name === 'id'));
  });

  it('단일 인용의 줄·컬럼·오프셋이 정확하다', () => {
    const r = f.tableRefs.find((x: any) => x.name === 'course');
    assert.equal(CODE7.slice(r.nameIndex, r.nameIndex + 6), 'course');
    assert.equal(r.nameLine, 1);
    assert.equal(r.nameColumn, CODE7.split('\n')[1].indexOf('course'));
  });

  it('이중 인용에서 두 번째 참조의 컬럼도 정확하다', () => {
    const r = f.tableRefs.find((x: any) => x.name === 'course_modules');
    assert.equal(CODE7.slice(r.nameIndex, r.nameIndex + r.name.length), 'course_modules');
    assert.equal(r.nameLine, 2);
    assert.equal(r.nameColumn, CODE7.split('\n')[2].indexOf('course_modules'));
  });

  it('heredoc 여러 줄에서 줄·컬럼이 정확하다', () => {
    const r = f.tableRefs.find((x: any) => x.name === 'grade_items');
    assert.equal(CODE7.slice(r.nameIndex, r.nameIndex + r.name.length), 'grade_items');
    assert.equal(r.nameLine, 5);
    assert.equal(r.nameColumn, CODE7.split('\n')[5].indexOf('grade_items'));
  });

  it('nowdoc의 위치도 정확하다', () => {
    const r = f.tableRefs.find((x: any) => x.name === 'assign');
    assert.equal(CODE7.slice(r.nameIndex, r.nameIndex + r.name.length), 'assign');
    assert.equal(r.nameLine, 9);
    assert.equal(r.nameColumn, CODE7.split('\n')[9].indexOf('assign'));
  });

  it('정규식 수량자도 이름으로는 뽑힌다 — 해석 단계에서 걸러진다', () => {
    const r = f.tableRefs.find((x: any) => x.name === '4');
    assert.equal(r.nameLine, 11);
  });
});
