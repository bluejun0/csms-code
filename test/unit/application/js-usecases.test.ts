import { strict as assert } from 'assert';
import { join } from 'path';
import { StringIndexStore } from '../../../src/infrastructure/lang/string-index-store';
import { TemplateIndex } from '../../../src/infrastructure/templates/template-index';
import { ResolveJsDefinition } from '../../../src/application/resolve-js-definition';
import { DescribeJsSymbol } from '../../../src/application/describe-js-symbol';
import { ListResolvedJsCalls } from '../../../src/application/list-resolved-js-calls';

const root = join(__dirname, '../../fixtures/mini-moodle');
const strings = new StringIndexStore();
strings.buildFromRoot(root);
const templates = new TemplateIndex();
templates.buildFromRoot(root);

const CODE = `define(['core/str'], function(str) {
    str.get_string('attendance_book', 'local_ubattend');
    Templates.render('local_ubattend/setting', {});
    str.get_string('missing_key', 'local_ubattend');
    Templates.render('local_ubattend/nope', {});
});
`;

describe('JS 유즈케이스 (E2E)', () => {
  const resolve = new ResolveJsDefinition(strings, templates);
  const describe_ = new DescribeJsSymbol(strings, templates);
  const list = new ListResolvedJsCalls(strings, templates);

  it('정의 이동: 문자열 키 → lang ko·en 두 위치', () => {
    const at = CODE.indexOf('attendance_book') + 3;
    const locs = resolve.run(CODE, at);
    assert.equal(locs.length, 2);
    assert.ok(locs.some(l => l.location.uri.endsWith(join('lang', 'ko', 'local_ubattend.php'))));
  });
  it('정의 이동: 템플릿 ref → 원본+오버라이드 두 위치', () => {
    const at = CODE.indexOf('local_ubattend/setting') + 3;
    const locs = resolve.run(CODE, at);
    assert.equal(locs.length, 2);
    assert.ok(locs.every(l => l.location.uri.endsWith('setting.mustache')));
  });
  it('정의 이동: 커서가 리터럴 밖이면 빈 배열', () =>
    assert.deepEqual(resolve.run(CODE, CODE.indexOf('define')), []));
  it('hover: 문자열은 한국어 값 포함', () => {
    const r = describe_.run(CODE, CODE.indexOf('attendance_book') + 3)!;
    assert.match(r.markdown, /출석부/);
  });
  it('hover: 템플릿은 컴포넌트·이름 표시', () => {
    const r = describe_.run(CODE, CODE.indexOf('local_ubattend/setting') + 3)!;
    assert.match(r.markdown, /local_ubattend/);
    assert.match(r.markdown, /setting/);
  });
  it('해석 범위: 존재하는 것만(누락 키·미존재 템플릿 제외)', () => {
    const r = list.run(CODE);
    assert.equal(r.length, 2);
    assert.deepEqual(r.map(x => x.length).sort((a, b) => a - b),
      ['attendance_book'.length, 'local_ubattend/setting'.length].sort((a, b) => a - b));
  });
});
