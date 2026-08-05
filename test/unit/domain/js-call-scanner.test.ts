import { strict as assert } from 'assert';
import { scanJsCalls } from '../../../src/domain/code-analysis/js-call-scanner';

const CODE = `define(['core/str', 'core/templates'], function(str, Templates) {
    var a = M.util.get_string('confirm_delete', 'local_ubnotification');
    var b = str.get_string("attendance_book", "local_ubattend");
    var c = getString('ok', 'core');
    Templates.render('local_ubattend/setting', {});
    const { html } = await renderForPromise("local_talk/common/toast", {});
    render('no_slash_here', {});
    somethingElse('local_x/y', {});
});
`;

describe('scanJsCalls', () => {
  const r = scanJsCalls(CODE);

  it('M.util.get_string / <모듈>.get_string / getString 3형태 모두 추출', () => {
    const keys = r.stringCalls.map(c => c.key).sort();
    assert.deepEqual(keys, ['attendance_book', 'confirm_delete', 'ok']);
  });
  it('겹따옴표도 인식하고 component를 정확히 짝지음', () => {
    const c = r.stringCalls.find(x => x.key === 'attendance_book')!;
    assert.equal(c.component, 'local_ubattend');
  });
  it('문자열 키 위치가 리터럴 내용 시작을 가리킴', () => {
    const c = r.stringCalls.find(x => x.key === 'confirm_delete')!;
    assert.equal(CODE.slice(c.keyIndex, c.keyIndex + c.key.length), 'confirm_delete');
    assert.equal(c.keyLine, 1);
  });
  it('Templates.render·구조분해 renderForPromise 모두 추출', () => {
    const refs = r.templateCalls.map(c => c.ref).sort();
    assert.deepEqual(refs, ['local_talk/common/toast', 'local_ubattend/setting']);
  });
  it("'/' 없는 ref와 render 아닌 함수는 비추출", () => {
    assert.ok(!r.templateCalls.some(c => c.ref === 'no_slash_here'));
    assert.ok(!r.templateCalls.some(c => c.ref === 'local_x/y'));
  });
  it('템플릿 ref 위치가 리터럴 내용 시작을 가리킴', () => {
    const c = r.templateCalls.find(x => x.ref === 'local_ubattend/setting')!;
    assert.equal(CODE.slice(c.refIndex, c.refIndex + c.ref.length), 'local_ubattend/setting');
    assert.equal(c.refLine, 4);
  });
  it('빈 텍스트·호출 없음 → 빈 배열', () => {
    const e = scanJsCalls('const x = 1;\n');
    assert.deepEqual(e.stringCalls, []);
    assert.deepEqual(e.templateCalls, []);
  });
  it('한 줄에 호출이 여러 개여도 컬럼이 각각 정확', () => {
    const line = `x(); M.util.get_string('a_key', 'local_x'); str.get_string('b_key', 'local_x');`;
    const r2 = scanJsCalls(line);
    assert.equal(r2.stringCalls.length, 2);
    for (const c of r2.stringCalls) {
      assert.equal(c.keyLine, 0);
      assert.equal(line.slice(c.keyColumn, c.keyColumn + c.key.length), c.key, `컬럼이 키를 정확히 가리켜야 함: ${c.key}`);
    }
  });
});
