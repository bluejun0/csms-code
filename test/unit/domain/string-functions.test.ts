import { strict as assert } from 'assert';
import { stringFunctionForm, stringClassForm, effectiveComponent, STRING_CLASS_ALTERNATION } from '../../../src/domain/code-analysis/string-functions';

describe('문자열 호출 형태 표', () => {
  it('함수와 클래스는 서로 다른 조회', () => {
    assert.equal(stringFunctionForm('print_error')?.defaultComponent, 'error');
    assert.equal(stringClassForm('moodle_exception')?.defaultComponent, 'error');
    assert.equal(stringFunctionForm('moodle_exception'), undefined);
    assert.equal(stringClassForm('get_string'), undefined);
  });
  it('error 계열: 생략·moodle·core → error, 명시는 그대로', () => {
    const f = stringFunctionForm('print_error')!;
    assert.equal(effectiveComponent(f, ''), 'error');
    assert.equal(effectiveComponent(f, 'moodle'), 'error');
    assert.equal(effectiveComponent(f, 'core'), 'error');
    assert.equal(effectiveComponent(f, 'local_x'), 'local_x');
  });
  it('core 계열: 생략·moodle → core, 나머지는 그대로(정규화는 색인이 한다)', () => {
    const f = stringFunctionForm('get_string')!;
    assert.equal(effectiveComponent(f, ''), 'core');
    assert.equal(effectiveComponent(f, 'moodle'), 'core');
    assert.equal(effectiveComponent(f, 'testmod'), 'testmod');
  });
  it('클래스 대안 패턴에 세 클래스', () => {
    for (const c of ['moodle_exception', 'lang_string', 'help_icon']) assert.ok(STRING_CLASS_ALTERNATION.includes(c));
  });
});
