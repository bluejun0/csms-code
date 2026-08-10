import { strict as assert } from 'assert';
import { join } from 'path';
import { TemplateIndex } from '../../../src/infrastructure/templates/template-index';
import { StringIndexStore } from '../../../src/infrastructure/lang/string-index-store';
import { PhpUsageIndex } from '../../../src/infrastructure/usage/php-usage-index';
import { ResolveMustacheDefinition } from '../../../src/application/resolve-mustache-definition';
import { DescribeMustacheSymbol } from '../../../src/application/describe-mustache-symbol';
import { ListResolvedMustacheRefs } from '../../../src/application/list-resolved-mustache-refs';
import { FindTemplateReferences } from '../../../src/application/find-template-references';
import { clearPluginTypeCache } from '../../../src/infrastructure/workspace/plugin-type-map';

const root = join(__dirname, '../../fixtures/mini-moodle');

const CODE = [
  '<div>',
  '  {{> local_ubattend/setting }}',
  '  {{> local_ubattend/nope }}',
  '  {{#str}}attendance_book, local_ubattend{{/str}}',
  '  {{#str}}no_such_key, local_ubattend{{/str}}',
  '</div>',
].join('\n');

describe('Mustache 유즈케이스 (E2E)', () => {
  let resolve: ResolveMustacheDefinition;
  let describe_: DescribeMustacheSymbol;
  let list: ListResolvedMustacheRefs;
  let templates: TemplateIndex;

  before(() => {
    clearPluginTypeCache();
    templates = new TemplateIndex(); templates.buildFromRoot(root);
    const strings = new StringIndexStore(); strings.buildFromRoot(root);
    resolve = new ResolveMustacheDefinition(templates, strings);
    describe_ = new DescribeMustacheSymbol(templates, strings);
    list = new ListResolvedMustacheRefs(templates, strings);
  });

  const at = (needle: string, offset = 1) => CODE.indexOf(needle) + offset;

  it('partial에서 그 템플릿 파일로 이동한다(테마 오버라이드 포함)', () => {
    const locs = resolve.run(CODE, at('local_ubattend/setting'));
    assert.equal(locs.length, 2, '원본 + 테마 오버라이드');
    assert.ok(locs.every(l => l.location.uri.endsWith('setting.mustache')));
  });

  it('{{#str}} 키에서 lang 파일로 이동한다', () => {
    const locs = resolve.run(CODE, at('attendance_book'));
    assert.ok(locs.length >= 1);
    assert.ok(locs.some(l => l.location.uri.includes(join('lang', 'ko'))), locs.map(l => l.location.uri).join(','));
  });

  it('색인에 없는 참조·키는 빈 결과', () => {
    assert.deepEqual(resolve.run(CODE, at('local_ubattend/nope')), []);
    assert.deepEqual(resolve.run(CODE, at('no_such_key')), []);
    assert.deepEqual(resolve.run(CODE, CODE.indexOf('<div>')), []);
  });

  it('hover: 문자열 키는 값을, 템플릿 참조는 이름을 보여준다', () => {
    const s = describe_.run(CODE, at('attendance_book'));
    assert.ok(s && /attendance_book/.test(s.markdown), s?.markdown);
    const t = describe_.run(CODE, at('local_ubattend/setting'));
    assert.ok(t && /local_ubattend\/setting/.test(t.markdown), t?.markdown);
    assert.match(t!.markdown, /2곳/, '오버라이드가 있으면 개수를 알려준다');
  });

  it('하이라이트는 템플릿과 문자열을 따로, 해석되는 것만 준다', () => {
    const t = list.runTemplates(CODE);
    assert.deepEqual(t.map(r => r.length), ['local_ubattend/setting'.length]);
    assert.equal(t[0].line, 1);
    const s = list.runStrings(CODE);
    assert.deepEqual(s.map(r => r.length), ['attendance_book'.length]);
    assert.equal(s[0].line, 3);
  });

  it('사용처: 원본과 테마 오버라이드 어느 쪽에서 물어도 같은 목록이 나온다', () => {
    const usage = new PhpUsageIndex(() => true);
    usage.updateFileText('/w/theme/coursemos/templates/page.mustache', CODE);
    const find = new FindTemplateReferences(usage);
    const refs = find.run('local_ubattend', 'setting');
    assert.equal(refs.length, 1, 'mustache의 partial이 사용처로 잡힌다');

    // 두 파일(원본·오버라이드)이 같은 키를 공유하므로 어느 쪽에서 역산해도 같은 키다.
    const locs = templates.locationsOf('local_ubattend', 'setting');
    assert.equal(locs.length, 2);
  });
});
