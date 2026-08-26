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

// foreach key=>value / by-ref / key=>&value 형태와, dataArg가 읽기 메서드·3번째 인자를 잡지 않는 것
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

// kill-on-reassign: 일반 대입(plainAssignments) 추출
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

// 문법 고정 — 복합·구조분해·참조 대입은 plainAssignments에 캡처되지 않는다(낙관 동작).
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

// get_string 리터럴 호출 추출
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

// render_from_template 리터럴 호출
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

describe('TreeSitterPhpSyntax — 파싱 불가 문서', () => {
  let syn: TreeSitterPhpSyntax;
  before(async () => { syn = await TreeSitterPhpSyntax.create(); });

  // 이 grammar/런타임 조합은 16진 이스케이프가 있는 파일에서 파싱이 실패한다.
  const HEX = '<?php\n$sig = "\\x00";\n$sql = \'SELECT * FROM {user}\';\n';

  it('16진 이스케이프가 있어도 예외를 던지지 않는다', () => {
    assert.doesNotThrow(() => syn.facts(HEX));
  });

  it('파싱 실패는 빈 팩트로 떨어진다', () => {
    const f = syn.facts(HEX);
    assert.deepEqual(f.tableRefs, []);
    assert.deepEqual(f.assignments, []);
    assert.deepEqual(f.propertyAccesses, []);
    assert.deepEqual(f.stringCalls, []);
  });

  // 파싱 실패는 바로 다음 파싱 한 번을 함께 오염시킨다 — 정상 문서가 그 자리에 걸려도 결과가 나와야 한다.
  it('실패 직후 문서도 정상 파싱된다', () => {
    syn.facts(HEX);
    const f = syn.facts(`<?php\n$sql = 'SELECT * FROM {course}';\n`);
    assert.deepEqual(f.tableRefs.map((r: any) => r.name), ['course']);
  });

  // 오염된 상태에서는 예외 없이 노드가 누락된 트리가 나오므로, 팩트 수까지 확인해야 잡힌다.
  it('실패 직후 문서의 팩트가 누락 없이 나온다', () => {
    const TWO = `<?php\n$a = $DB->get_record('user', []);\n$b = $DB->get_record('assign', []);\n`;
    const expected = syn.facts(TWO).assignments.length;
    assert.equal(expected, 2);
    for (let i = 0; i < 3; i++) {
      syn.facts(HEX);
      assert.equal(syn.facts(TWO).assignments.length, expected, `${i}번째 문서에서 팩트가 누락됐다`);
    }
  });
});

// js_call_amd 모듈 참조 추출 — render_from_template와 같은 쿼리를 메서드명으로 가른다.
const CODE9 = `<?php
function page() {
  $PAGE->requires->js_call_amd('local_ubattend/setting', 'init');
  $PAGE->requires->js_call_amd('local_ubattend/sub/nested', 'init', [1]);
  $this->page->requires->js_call_amd('block_testblock/main', 'init');
  $PAGE->requires->js_call_amd($dynamic, 'init');
  $OUTPUT->render_from_template('local_ubattend/setting', []);
  $DB->get_record('user', ['id' => 1]);
}
`;

describe('TreeSitterPhpSyntax — amdCalls (js_call_amd)', () => {
  let syn: TreeSitterPhpSyntax; let f: any;
  before(async () => { syn = await TreeSitterPhpSyntax.create(); f = syn.facts(CODE9); });

  it('수신자 무관 추출·중첩 경로 포함, 동적 인자는 비추출', () => {
    assert.deepEqual(f.amdCalls.map((x: any) => x.ref),
      ['local_ubattend/setting', 'local_ubattend/sub/nested', 'block_testblock/main']);
  });

  it('ref 위치 정확성', () => {
    const c = f.amdCalls[0];
    assert.equal(CODE9.slice(c.refIndex, c.refIndex + c.ref.length), 'local_ubattend/setting');
    assert.equal(c.refLine, 2);
    assert.equal(c.refColumn, CODE9.split('\n')[2].indexOf('local_ubattend/setting'));
  });

  it('render_from_template·$DB 호출과 섞이지 않는다', () => {
    assert.deepEqual(f.templateCalls.map((x: any) => x.ref), ['local_ubattend/setting']);
    assert.equal(f.templateCalls[0].refLine, 6);
    assert.ok(!f.amdCalls.some((x: any) => x.refLine === 6 || x.ref === 'user'));
  });
});

// 전역 멤버를 짚으려면 메서드 호출도 팩트로 필요하다 — 프로퍼티 접근과는 노드가 다르다.
const CODE10 = `<?php
function q() {
  global $DB;
  $r = $DB->get_record('user', ['id' => 1]);
  $DB->update_record('user', $r);
  echo $USER->firstname;
  echo $PAGE->context;
}
`;

describe('TreeSitterPhpSyntax — methodCalls', () => {
  let syn: TreeSitterPhpSyntax; let f: any;
  before(async () => { syn = await TreeSitterPhpSyntax.create(); f = syn.facts(CODE10); });

  it('수신 변수와 메서드 이름을 위치와 함께 잡는다', () => {
    const calls = f.methodCalls.filter((c: any) => c.varName === 'DB').map((c: any) => c.method);
    assert.deepEqual(calls, ['get_record', 'update_record']);
    const first = f.methodCalls.find((c: any) => c.method === 'get_record');
    assert.equal(CODE10.slice(first.nameIndex, first.nameIndex + 'get_record'.length), 'get_record');
    assert.equal(first.nameLine, 3);
    assert.equal(first.nameColumn, CODE10.split('\n')[3].indexOf('get_record'));
  });

  it('프로퍼티 접근은 methodCalls에 들어가지 않는다', () => {
    assert.ok(!f.methodCalls.some((c: any) => c.method === 'firstname' || c.method === 'context'));
    assert.ok(f.propertyAccesses.some((p: any) => p.property === 'firstname'));
  });

  it('스코프를 가진다', () => {
    assert.ok(f.methodCalls[0].scope.end > f.methodCalls[0].scope.start);
  });
});

// $DB 메서드의 테이블 인자도 SQL의 {table}과 같은 팩트에 담긴다.
const CODE11 = `<?php
function q() {
  $DB->update_record('local_ubattend_config', $data);
  $r = $DB->get_record('user', ['id' => 1]);
  $DB->get_records_sql('SELECT * FROM {course} WHERE x = ?');
  $DB->get_field('user', 'firstname', []);
  $OUTPUT->render_from_template('local_ubattend/setting', []);
  $other->update_record('not_db', $x);
  $DB->sql_like('user', ':pattern');
}
`;

describe('TreeSitterPhpSyntax — $DB 테이블 인자', () => {
  let syn: TreeSitterPhpSyntax; let f: any;
  before(async () => { syn = await TreeSitterPhpSyntax.create(); f = syn.facts(CODE11); });

  it('첫 문자열 인자를 테이블 참조로 담는다', () => {
    const names = f.tableRefs.map((r: any) => r.name);
    assert.ok(names.includes('local_ubattend_config'));
    assert.ok(names.includes('user'), 'get_record·get_field 모두');
  });

  it('SQL 안의 {table}과 같은 배열에 함께 담긴다', () => {
    assert.ok(f.tableRefs.some((r: any) => r.name === 'course'), '{course}');
  });

  it('$DB가 아닌 수신자와 다른 메서드의 첫 인자는 담지 않는다', () => {
    const names = f.tableRefs.map((r: any) => r.name);
    assert.ok(!names.includes('not_db'), '$other-> 는 대상 아님');
    assert.ok(!names.includes('local_ubattend/setting'), 'render_from_template은 대상 아님');
  });

  it('sql_ 헬퍼의 첫 인자는 컬럼·식이라 담지 않는다', () => {
    // 'user'는 테이블 이름이기도 해서, 메서드로 걸러내지 않으면 컬럼을 테이블로 링크한다.
    const userRefs = f.tableRefs.filter((r: any) => r.name === 'user');
    assert.equal(userRefs.length, 2, 'get_record와 get_field의 것만');
  });

  it('테이블 인자 위치가 정확하다', () => {
    const r = f.tableRefs.find((x: any) => x.name === 'local_ubattend_config');
    assert.equal(CODE11.slice(r.nameIndex, r.nameIndex + r.name.length), 'local_ubattend_config');
    assert.equal(r.nameLine, 2);
    assert.equal(r.nameColumn, CODE11.split('\n')[2].indexOf('local_ubattend_config'));
  });
});

// 컴포넌트가 리터럴이 아닌 get_string — 형태를 담고 리터럴 출처도 함께 뽑는다.
const CODE12 = `<?php
class X {
    protected $pluginname = 'local_ubattend';
    const NAME = 'local_const';
    public function f() {
        $comp = 'local_var';
        echo get_string('k1', $comp);
        echo get_string('k2', $this->pluginname);
        echo get_string('k3', self::NAME);
        echo get_string('k4', X::NAME);
        echo get_string('k5', $other->pluginname);
        echo get_string('k6', 'local_literal');
        echo other_func('k7', $comp);
    }
}
`;

describe('TreeSitterPhpSyntax — 동적 컴포넌트 호출', () => {
  let syn: TreeSitterPhpSyntax; let f: any;
  before(async () => { syn = await TreeSitterPhpSyntax.create(); f = syn.facts(CODE12); });

  it('변수·$this 프로퍼티·상수 세 형태를 담는다', () => {
    const got = f.dynamicStringCalls.map((c: any) => `${c.key}:${c.comp.kind}:${c.comp.name}`);
    assert.deepEqual(got, ['k1:var:comp', 'k2:prop:pluginname', 'k3:const:NAME', 'k4:const:NAME']);
  });

  it('$this 아닌 수신자와 get_string 아닌 함수는 담지 않는다', () => {
    const keys = f.dynamicStringCalls.map((c: any) => c.key);
    assert.ok(!keys.includes('k5'), '$other->는 이 파일에서 정의를 알 수 없다');
    assert.ok(!keys.includes('k7'), 'other_func은 대상 아님');
  });

  it('리터럴 컴포넌트 호출은 기존 stringCalls에만 담긴다', () => {
    assert.ok(f.stringCalls.some((c: any) => c.key === 'k6' && c.component === 'local_literal'));
    assert.ok(!f.dynamicStringCalls.some((c: any) => c.key === 'k6'), '두 목록에 겹치면 진단·하이라이트가 두 번 나온다');
  });

  it('키 위치와 스코프를 담는다', () => {
    const c = f.dynamicStringCalls[0];
    assert.equal(CODE12.slice(c.keyIndex, c.keyIndex + c.key.length), 'k1');
    assert.equal(c.keyLine, 6);
    assert.ok(c.scope.end > c.scope.start);
  });

  it('리터럴 출처 세 종류를 뽑는다', () => {
    assert.deepEqual(f.literalAssignments.map((a: any) => `${a.varName}=${a.value}`), ['comp=local_var']);
    assert.deepEqual(f.propertyLiterals.map((p: any) => `${p.property}=${p.value}`), ['pluginname=local_ubattend']);
    assert.deepEqual(f.constLiterals.map((c: any) => `${c.name}=${c.value}`), ['NAME=local_const']);
  });

  it('생성자 대입은 프로퍼티 출처로 담지 않는다', () => {
    const code = `<?php\nclass Y { function __construct() { $this->pluginname = 'local_ctor'; } }\n`;
    assert.deepEqual(syn.facts(code).propertyLiterals, []);
  });
});

describe('TreeSitterPhpSyntax — print_string', () => {
  const CODE = `<?php
class x {
  public $pluginname = 'local_ubattend';
  function f() {
    print_string('attendance_book', 'local_ubattend');
    print_string('attendance_rate', $this->pluginname);
  }
}
`;
  let f: any;
  before(async () => { f = (await TreeSitterPhpSyntax.create()).facts(CODE); });

  it('리터럴 컴포넌트 print_string은 stringCalls에 담긴다', () => {
    const c = f.stringCalls.find((x: any) => x.key === 'attendance_book');
    assert.ok(c, 'print_string 호출이 잡혀야 한다');
    assert.equal(c.component, 'local_ubattend');
    assert.equal(c.keyIndex, CODE.indexOf('attendance_book'));
  });
  it('동적 컴포넌트 print_string은 dynamicStringCalls에 담긴다', () => {
    const c = f.dynamicStringCalls.find((x: any) => x.key === 'attendance_rate');
    assert.ok(c, '동적 print_string 호출이 잡혀야 한다');
    assert.deepEqual(c.comp, { kind: 'prop', name: 'pluginname' });
  });
});

describe('TreeSitterPhpSyntax — 문자열 호출 가족(한 인자·print_error·new 식)', () => {
  const CODE = `<?php
echo get_string('ok');
print_error('nocode');
print_error('mcode', 'moodle');
print_error('lcode', 'local_ubattend');
throw new moodle_exception('excode', 'local_ubattend');
throw new \\moodle_exception('bare');
$s = new lang_string('lscode');
$h = new help_icon('hkey', 'local_ubattend');
`;
  let f: any;
  before(async () => { f = (await TreeSitterPhpSyntax.create()).facts(CODE); });
  const comp = (key: string) => f.stringCalls.find((x: any) => x.key === key)?.component;

  it('한 인자 get_string은 core', () => assert.equal(comp('ok'), 'core'));
  it('print_error는 컴포넌트 생략·moodle이면 error, 명시하면 그대로', () => {
    assert.equal(comp('nocode'), 'error');
    assert.equal(comp('mcode'), 'error');
    assert.equal(comp('lcode'), 'local_ubattend');
  });
  it('new moodle_exception — 두 인자·네임스페이스 접두 한 인자', () => {
    assert.equal(comp('excode'), 'local_ubattend');
    assert.equal(comp('bare'), 'error');
    const c = f.stringCalls.find((x: any) => x.key === 'bare');
    assert.equal(c.keyIndex, CODE.indexOf("'bare'") + 1, '키 위치는 리터럴 내용 시작');
  });
  it('new lang_string(한 인자 → core)·new help_icon', () => {
    assert.equal(comp('lscode'), 'core');
    assert.equal(comp('hkey'), 'local_ubattend');
  });
});

describe('TreeSitterPhpSyntax — 설정 호출', () => {
  const CODE = `<?php
class y {
  public $pluginname = 'local_ubattend';
  function f() {
    $a = get_config('local_ubattend', 'apikey');
    set_config('mode', 1, 'local_ubattend');
    set_config('arr', ['a' => 1], 'local_ubattend');
    $b = get_config($this->pluginname, 'dyn');
    set_config('dyn2', $b, $this->pluginname);
    $c = get_config('local_ubattend');
    $d = get_config('local_ubattend', $k);
    echo get_string('apikey', 'local_ubattend');
  }
}
`;
  let f: any;
  before(async () => { f = (await TreeSitterPhpSyntax.create()).facts(CODE); });

  it('get_config(plugin, key) → get, set_config(key, value, plugin) → set(값이 배열이어도)', () => {
    assert.deepEqual(f.configCalls.map((c: any) => `${c.kind}:${c.plugin}/${c.key}`).sort(),
      ['get:local_ubattend/apikey', 'set:local_ubattend/arr', 'set:local_ubattend/mode']);
    const mode = f.configCalls.find((c: any) => c.key === 'mode');
    assert.equal(mode.keyIndex, CODE.indexOf("'mode'") + 1);
  });
  it('플러그인이 $this->프로퍼티면 dynamicConfigCalls', () => {
    assert.deepEqual(f.dynamicConfigCalls.map((c: any) => `${c.kind}:${c.key}:${c.comp.kind}:${c.comp.name}`).sort(),
      ['get:dyn:prop:pluginname', 'set:dyn2:prop:pluginname']);
  });
  it("set_config('k', 'v') 두 인자(코어)는 configCalls에 없다", async () => {
    const g = (await TreeSitterPhpSyntax.create()).facts("<?php\nset_config('sitename', 'x');\n");
    assert.deepEqual(g.configCalls, []);
  });
  it('한 인자·동적 키는 팩트 없음, get_string은 설정 호출이 아니다', () => {
    assert.ok(!f.configCalls.some((c: any) => c.key === 'local_ubattend'));
    assert.equal(f.stringCalls.filter((c: any) => c.key === 'apikey').length, 1, 'get_string만');
  });
});
