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

describe('parseLangFile — 인용부호 조합', () => {
  it('겹따옴표 값도 읽는다', () => {
    const out = parseLangFile(`<?php\n$string['a'] = "메일 전송 실패";\n`);
    assert.deepEqual(out.map(x => `${x.key}=${x.value}`), ['a=메일 전송 실패']);
  });

  it('홑따옴표 값 안의 겹따옴표를 잃지 않는다', () => {
    const out = parseLangFile(`<?php\n$string['a'] = '<a href="x">링크</a>';\n`);
    assert.equal(out.length, 1);
    assert.equal(out[0].value, '<a href="x">링크</a>');
  });

  it('겹따옴표 값 안의 홑따옴표도 읽는다', () => {
    const out = parseLangFile(`<?php\n$string['a'] = "그 사람's 것";\n`);
    assert.equal(out.length, 1);
    assert.equal(out[0].value, "그 사람's 것");
  });

  it('키가 겹따옴표여도 읽는다', () => {
    const out = parseLangFile(`<?php\n$string["a"] = 'v';\n`);
    assert.deepEqual(out.map(x => x.key), ['a']);
  });

  it('두 인용 방식이 섞인 파일에서 줄 번호가 정확하다', () => {
    const out = parseLangFile(`<?php\n$string['a'] = 'x';\n$string['b'] = "y";\n$string['c'] = 'z';\n`);
    assert.deepEqual(out.map(x => `${x.key}:${x.line}`), ['a:1', 'b:2', 'c:3']);
  });
});

describe('parseLangFile — 연결 연산자', () => {
  it('리터럴 연결을 이어 붙인다', () => {
    const out = parseLangFile(`<?php\n$string['a'] = '앞' . "\\n" . '뒤';\n`);
    assert.equal(out.length, 1);
    assert.equal(out[0].value, '앞\\n뒤');
  });

  it('여러 줄 연결도 하나로 읽는다', () => {
    const out = parseLangFile(`<?php\n$string['a'] = '앞'\n  . '뒤';\n$string['b'] = 'x';\n`);
    assert.deepEqual(out.map(x => `${x.key}=${x.value}`), ['a=앞뒤', 'b=x']);
  });

  it('값 안의 $string 참조를 새 항목으로 오인하지 않는다', () => {
    const out = parseLangFile(`<?php\n$string['a'] = '앞' . $string['other'] . '뒤';\n`);
    assert.deepEqual(out.map(x => x.key), ['a'], "'other'는 항목이 아니다");
    assert.match(out[0].value, /^앞.*뒤$/);
  });

  it('비리터럴 조각은 자리표시자로 남고 키는 살아 있다', () => {
    const out = parseLangFile(`<?php\n$string['a'] = get_something();\n`);
    assert.deepEqual(out.map(x => x.key), ['a'], '값을 몰라도 키는 정의된 것이다');
  });

  it('종결 세미콜론이 없으면 그 항목을 버린다', () => {
    assert.deepEqual(parseLangFile(`<?php\n$string['a'] = '닫히지 않음\n`), []);
  });

  it('연결이 섞여도 줄 번호가 정확하다', () => {
    const out = parseLangFile(`<?php\n$string['a'] = 'x';\n$string['b'] = 'y' . 'z';\n$string['c'] = 'w';\n`);
    assert.deepEqual(out.map(x => `${x.key}:${x.line}`), ['a:1', 'b:2', 'c:3']);
  });
});
