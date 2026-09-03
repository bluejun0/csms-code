import { strict as assert } from 'assert';
import { readClassMembers } from '../../../src/infrastructure/php/class-members';
import { PhpRuntime } from '../../../src/infrastructure/php/tree-sitter-runtime';

const CODE = `<?php
class moodle_page {
  /** 페이지 컨텍스트. 자세한 설명. */
  protected function magic_get_context() {}
  public $bodyid;
  private $hidden;
  private function secret() {}
  /** 레코드를 읽는다. */
  public function get_record($table, $conditions) {}
  public function reset() {}
}`;

describe('readClassMembers', () => {
  let members: ReturnType<typeof readClassMembers>;
  before(async () => {
    const runtime = await PhpRuntime.create();
    const doc = runtime.parse(CODE)!;
    members = readClassMembers(doc.classBody('moodle_page')!);
    doc.dispose();
  });

  it('public 메서드는 시그니처와 첫 문장을 담는다', () => {
    const m = members.find(x => x.name === 'get_record')!;
    assert.equal(m.kind, 'method');
    assert.equal(m.signature, '($table, $conditions)');
    assert.equal(m.doc, '레코드를 읽는다.');
  });
  it('public 프로퍼티를 담는다', () => {
    assert.equal(members.find(x => x.name === 'bodyid')!.kind, 'property');
  });
  it('magic_get_은 프로퍼티로 바꿔 담는다', () => {
    assert.equal(members.find(x => x.name === 'context')!.kind, 'property');
  });
  it('docBefore는 첫 문장만 추출한다', () => {
    const m = members.find(x => x.name === 'context')!;
    assert.equal(m.doc, '페이지 컨텍스트.');
  });
  it('formal_parameters가 없는 메서드는 () 시그니처를 담는다', () => {
    const m = members.find(x => x.name === 'reset')!;
    assert.equal(m.kind, 'method');
    assert.equal(m.signature, '()');
  });
  it('private 멤버는 담지 않는다', () => {
    assert.ok(!members.some(x => x.name === 'hidden' || x.name === 'secret'));
  });
});
