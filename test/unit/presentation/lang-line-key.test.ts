import { strict as assert } from 'assert';
import { langKeyAt } from '../../../src/presentation/lang-line-key';

const LINE = "$string['attendance_book'] = '출석부';";

describe('langKeyAt', () => {
  it('커서가 키 내용 위 → 키 반환', () =>
    assert.equal(langKeyAt(LINE, LINE.indexOf('attendance_book') + 3), 'attendance_book'));
  it('커서가 키 시작 앞(여는 따옴표) → null', () =>
    assert.equal(langKeyAt(LINE, LINE.indexOf("'attendance_book'")), null));
  it('커서가 값 영역 → null', () =>
    assert.equal(langKeyAt(LINE, LINE.indexOf('출석부')), null));
  it('$string 패턴 없는 줄 → null', () =>
    assert.equal(langKeyAt('echo $x;', 3), null));
  it("키가 '$string[' 자신과 충돌('string')해도 정확", () => {
    const line = "$string['string'] = 'x';";
    assert.equal(langKeyAt(line, line.indexOf("'string'") + 3), 'string');
    assert.equal(langKeyAt(line, 2), null); // $string[ 접두부는 키가 아님
  });
});
