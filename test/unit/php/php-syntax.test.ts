import { strict as assert } from 'assert';
import { MAX_DOCUMENT_BYTES, TreeSitterPhpSyntax } from '../../../src/infrastructure/php/php-syntax';

// get_record_sql은 첫 인자가 SQL 문자열이 아니라 변수여야 한다 — 리터럴 문자열이면
// assignWithTable도 "첫 인자가 문자열"이라는 같은 모양으로 매칭돼 tableArg가 채워진다.
const CODE = `<?php
function f() {
  $rec = $DB->get_record('assign', ['id' => 1]);
  $plain = $DB->get_record_sql($sql);
  $rows = $DB->get_records('local_log', []);
  foreach ($rows as $r) { echo $r->id; }
  echo get_string('key', 'local_x');
}`;

describe('TreeSitterPhpSyntax', () => {
  let syntax: TreeSitterPhpSyntax;
  before(async () => { syntax = await TreeSitterPhpSyntax.create(); });

  it('테이블 있는 대입이 없는 대입을 이긴다', () => {
    const found = syntax.facts(CODE).assignments.filter(a => a.varName === 'rec');
    assert.equal(found.length, 1);
    assert.equal(found[0].tableArg, 'assign');
  });
  it('테이블 인자가 없는 대입도 담는다', () => {
    const found = syntax.facts(CODE).assignments.find(a => a.varName === 'plain')!;
    assert.equal(found.tableArg, null);
    assert.equal(found.method, 'get_record_sql');
  });
  it('백슬래시가 든 문자열 리터럴은 매치가 여러 개로 갈라져도 전부 남는다 — index당 하나가 아니라 옛 구현과 같은 규칙', () => {
    // 'content\\cm\\cmname'는 grammar에서 string_content 자식 3개(content/cm/cmname)로
    // 갈린다 — assignWithTable이 이 문서에 3번 매치한다. 이전 구현은 이 3개를 전부 쌓고 같은
    // index의 null 항목만 버린다(preferTableArg가 "index당 하나"가 아니라 이 규칙을 따라야
    // 하는 이유). 기대값 3·["content","cm","cmname"]는 이전 구현을 이 소스에 직접 돌려
    // 확인한 실측치다 — 규칙만 보고 짐작한 값이 아니다.
    const src = `<?php
function f() {
  $x = $format->get_output_classname('content\\\\cm\\\\cmname');
}`;
    const found = syntax.facts(src).assignments.filter(a => a.varName === 'x');
    assert.equal(found.length, 3);
    assert.deepEqual(found.map(a => a.tableArg), ['content', 'cm', 'cmname']);
  });
  it('foreach 바인딩은 위치당 하나다', () => {
    assert.equal(syntax.facts(CODE).foreachBindings.filter(b => b.itemVar === 'r').length, 1);
  });
  it('need에 없는 팩트는 만들지 않는다', () => {
    const f = syntax.facts(CODE, new Set(['stringCalls'] as const));
    assert.equal(f.stringCalls.length, 1);
    // assignments는 정규화를 거치므로 애초에 안 만들어졌는지 정규화가 빈 배열을 그대로
    // 돌려줬는지 이 값만으로는 구분 안 된다. 정규화를 안 거치는 plainAssignments로 게이팅
    // 자체를 확인한다 — need 없이는 3건(rec/plain/rows)이 나온다.
    assert.equal(f.assignments.length, 0);
    assert.equal(f.plainAssignments.length, 0);
  });
  it('16진 이스케이프가 있어도 다음 문서가 멀쩡하다', () => {
    syntax.facts('<?php $a = "\\x41";');
    assert.equal(syntax.facts(CODE).stringCalls.length, 1);
  });
  it('상한을 넘는 문서는 팩트가 없다', () => {
    const huge = `<?php $x = 1; ${'// filler\n'.repeat(MAX_DOCUMENT_BYTES / 10)}`;
    assert.equal(syntax.facts(huge).plainAssignments.length, 0);
  });
});
