import { strict as assert } from 'assert';
import { isStringKeyPrefix } from '../../../src/presentation/string-call-prefix';

describe('isStringKeyPrefix — 키 완성 트리거 문맥', () => {
  it("get_string(' 뒤에서 입력 중 → true", () =>
    assert.equal(isStringKeyPrefix("echo get_string('att"), true));
  it("print_string(' 뒤에서 입력 중 → true", () =>
    assert.equal(isStringKeyPrefix("print_string(\""), true));
  it('컴포넌트 인자 위치 → false', () =>
    assert.equal(isStringKeyPrefix("get_string('k', 'loc"), false));
  it('다른 함수의 첫 인자 → false', () =>
    assert.equal(isStringKeyPrefix("render_from_template('x"), false));
});
