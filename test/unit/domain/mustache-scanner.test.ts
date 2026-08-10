import { strict as assert } from 'assert';
import { scanMustache } from '../../../src/domain/code-analysis/mustache-scanner';

const TEXT = [
  '<div class="wrap">',
  '  {{> theme_coursemos/header }}',
  '  {{>local_ubthread/item}}',
  '  {{< core/modal }}',
  '  <h1>{{#str}}attendance_book, local_ubattend{{/str}}</h1>',
  '  <p>{{#cleanstr}}welcome, core{{/cleanstr}}</p>',
  '  {{#str}}',
  '    multiline_key, local_ubattend',
  '  {{/str}}',
  '  {{#str}}{{dynamickey}}, local_ubattend{{/str}}',
  '  {{> {{dynamic}} }}',
  '  {{name}}',
  '</div>',
].join('\n');

describe('scanMustache', () => {
  const refs = scanMustache(TEXT);

  it('partial과 parent 참조를 공백 변형과 함께 잡는다', () => {
    assert.deepEqual(refs.templateRefs.map(r => r.ref),
      ['theme_coursemos/header', 'local_ubthread/item', 'core/modal']);
  });

  it('{{#str}}·{{#cleanstr}}의 키와 컴포넌트를 잡는다(여러 줄 포함)', () => {
    assert.deepEqual(refs.stringRefs.map(r => `${r.component}/${r.key}`),
      ['local_ubattend/attendance_book', 'core/welcome', 'local_ubattend/multiline_key']);
  });

  it('변수 인자는 잡지 않는다', () => {
    assert.ok(!refs.stringRefs.some(r => r.key.includes('dynamic')));
    assert.ok(!refs.templateRefs.some(r => r.ref.includes('dynamic')));
  });

  it('템플릿 참조 위치가 정확하다', () => {
    const r = refs.templateRefs[1];
    assert.equal(r.ref, 'local_ubthread/item');
    assert.equal(TEXT.slice(r.index, r.index + r.ref.length), r.ref);
    assert.equal(r.line, 2);
    assert.equal(r.column, TEXT.split('\n')[2].indexOf('local_ubthread'));
  });

  it('문자열 키 위치가 정확하다 — 여러 줄에서도', () => {
    const first = refs.stringRefs[0];
    assert.equal(TEXT.slice(first.keyIndex, first.keyIndex + first.key.length), 'attendance_book');
    assert.equal(first.keyLine, 4);
    assert.equal(first.keyColumn, TEXT.split('\n')[4].indexOf('attendance_book'));

    const multi = refs.stringRefs[2];
    assert.equal(multi.keyLine, 7, '여는 태그가 아니라 키가 있는 줄');
    assert.equal(multi.keyColumn, TEXT.split('\n')[7].indexOf('multiline_key'));
  });

  it('참조가 없으면 빈 결과', () => {
    const empty = scanMustache('<div>{{name}}</div>');
    assert.deepEqual(empty.templateRefs, []);
    assert.deepEqual(empty.stringRefs, []);
  });
});
