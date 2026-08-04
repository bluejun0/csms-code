import { strict as assert } from 'assert';
import { parseLangFile } from '../../../src/infrastructure/lang/lang-file-parser';

describe('parseLangFile', () => {
  it('기본: 키·값·라인(0-based)', () => {
    const r = parseLangFile("<?php\n\n$string['attendance_book'] = '출석부';\n");
    assert.deepEqual(r, [{ key: 'attendance_book', value: '출석부', line: 2 }]);
  });
  it("이스케이프: \\' 는 ' 로", () => {
    const r = parseLangFile("<?php\n$string['x'] = 'It\\'s ok';\n");
    assert.equal(r[0].value, "It's ok");
  });
  it('여러 줄 값 + 다음 항목의 라인 정확성', () => {
    const r = parseLangFile("<?php\n$string['a'] = 'line1\nline2';\n$string['b'] = 'B';\n");
    assert.equal(r[0].value, 'line1\nline2');
    assert.deepEqual(r[1], { key: 'b', value: 'B', line: 3 });
  });
  it('{$a} 플레이스홀더는 그대로 보존', () => {
    const r = parseLangFile("<?php\n$string['n'] = '{$a}회차';\n");
    assert.equal(r[0].value, '{$a}회차');
  });
  it("콜론 포함 키('activitydate:lateness') 지원", () => {
    const r = parseLangFile("<?php\n$string['activitydate:lateness'] = '지각';\n");
    assert.equal(r[0].key, 'activitydate:lateness');
  });
});
