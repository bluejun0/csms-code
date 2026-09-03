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
  it('foreach 바인딩은 위치당 하나다', () => {
    assert.equal(syntax.facts(CODE).foreachBindings.filter(b => b.itemVar === 'r').length, 1);
  });
  it('need에 없는 팩트는 만들지 않는다', () => {
    const f = syntax.facts(CODE, new Set(['stringCalls'] as const));
    assert.equal(f.stringCalls.length, 1);
    assert.equal(f.assignments.length, 0);
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
