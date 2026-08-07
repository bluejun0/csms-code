import { strict as assert } from 'assert';
import { diagnosticCode, suggestionFromCode } from '../../../src/presentation/diagnostic-codes';

describe('진단 code', () => {
  it('종류가 코드에 담긴다 — 문자열 진단이 컬럼으로 보이지 않는다', () => {
    assert.equal(diagnosticCode('column'), 'csms.column');
    assert.equal(diagnosticCode('string'), 'csms.string');
    assert.equal(diagnosticCode('string', 'attendance_book'), 'csms.string.attendance_book');
  });

  it('QuickFix가 두 종류의 제안을 모두 읽는다', () => {
    assert.equal(suggestionFromCode('csms.column.courseid'), 'courseid');
    assert.equal(suggestionFromCode('csms.string.attendance_book'), 'attendance_book');
  });

  it('제안 없는 코드·다른 확장의 코드·숫자 코드는 QuickFix 대상이 아니다', () => {
    assert.equal(suggestionFromCode('csms.column'), null);
    assert.equal(suggestionFromCode('csms.string'), null);
    assert.equal(suggestionFromCode('other.column.x'), null);
    assert.equal(suggestionFromCode(1234), null);
    assert.equal(suggestionFromCode(undefined), null);
  });

  it('제안에 점이 들어가도 온전히 읽는다', () => {
    assert.equal(suggestionFromCode(diagnosticCode('string', 'a.b.c')), 'a.b.c');
  });
});
