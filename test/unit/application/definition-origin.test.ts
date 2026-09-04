import { strict as assert } from 'assert';
import { join } from 'path';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/php/php-syntax';
import { TemplateIndex } from '../../../src/infrastructure/templates/template-index';
import { AmdIndex } from '../../../src/infrastructure/amd/amd-index';
import { StringIndexStore } from '../../../src/infrastructure/lang/string-index-store';
import { ResolveTemplateDefinition } from '../../../src/application/resolve-template-definition';
import { ResolveAmdDefinition } from '../../../src/application/resolve-amd-definition';
import { ResolveStringDefinition } from '../../../src/application/resolve-string-definition';
import { ResolveJsDefinition } from '../../../src/application/resolve-js-definition';
import { ResolveMustacheDefinition } from '../../../src/application/resolve-mustache-definition';
import { RangeItem } from '../../../src/application/dto';

const root = join(__dirname, '../../fixtures/mini-moodle');
const templates = new TemplateIndex(); templates.buildFromRoot(root);
const amd = new AmdIndex(); amd.buildFromRoot(root);
const strings = new StringIndexStore(); strings.buildFromRoot(root);

/** 참조가 놓인 줄에서 그 텍스트가 차지하는 범위 — 기대값을 소스에서 도출한다. */
function rangeOf(source: string, needle: string): RangeItem {
  const at = source.indexOf(needle);
  const line = source.slice(0, at).split('\n').length - 1;
  const lineStart = source.lastIndexOf('\n', at - 1) + 1;
  return { line, column0: at - lineStart, length: needle.length };
}

describe('정의 이동의 출발 범위', () => {
  let syntax: TreeSitterPhpSyntax;
  before(async () => { syntax = await TreeSitterPhpSyntax.create(); });

  it('템플릿 참조는 슬래시를 포함한 전체가 한 범위다', () => {
    const code = `<?php\n  echo $OUTPUT->render_from_template('local_ubattend/setting', $d);\n`;
    const ref = 'local_ubattend/setting';
    const found = new ResolveTemplateDefinition(syntax, templates).run(code, code.indexOf(ref) + 3);
    assert.ok(found.length > 0, '템플릿이 해석되어야 한다');
    assert.deepEqual(found[0].origin, rangeOf(code, ref));
  });

  it('AMD 모듈 참조도 전체가 한 범위다', () => {
    const code = `<?php\n$PAGE->requires->js_call_amd('local_ubattend/view', 'init');\n`;
    const ref = 'local_ubattend/view';
    const found = new ResolveAmdDefinition(syntax, amd).run(code, code.indexOf(ref) + 3);
    assert.ok(found.length > 0, 'AMD 모듈이 해석되어야 한다');
    assert.deepEqual(found[0].origin, rangeOf(code, ref));
  });

  it('언어 문자열은 키만 범위로 잡는다 — 컴포넌트 인자는 제외', () => {
    const code = `<?php\necho get_string('attendance_book', 'local_ubattend');\n`;
    const found = new ResolveStringDefinition(syntax, strings).run(code, code.indexOf('attendance_book') + 2);
    assert.ok(found.length > 0, '문자열이 해석되어야 한다');
    assert.deepEqual(found[0].origin, rangeOf(code, 'attendance_book'));
  });

  it('JS의 템플릿 참조도 전체가 한 범위다', () => {
    const code = `import Templates from 'core/templates';\nTemplates.render('local_ubattend/setting', {});\n`;
    const ref = 'local_ubattend/setting';
    const found = new ResolveJsDefinition(strings, templates).run(code, code.indexOf(ref) + 3);
    assert.ok(found.length > 0, 'JS 템플릿이 해석되어야 한다');
    assert.deepEqual(found[0].origin, rangeOf(code, ref));
  });

  it('mustache의 partial 참조도 전체가 한 범위다', () => {
    const code = `<div>\n  {{> local_ubattend/setting}}\n</div>\n`;
    const ref = 'local_ubattend/setting';
    const found = new ResolveMustacheDefinition(templates, strings).run(code, code.indexOf(ref) + 3);
    assert.ok(found.length > 0, 'partial이 해석되어야 한다');
    assert.deepEqual(found[0].origin, rangeOf(code, ref));
  });

  it('범위는 참조 안 어디를 짚어도 같다 — 커서 위치에 따라 달라지지 않는다', () => {
    const code = `<?php\n  echo $OUTPUT->render_from_template('local_ubattend/setting', $d);\n`;
    const ref = 'local_ubattend/setting';
    const uc = new ResolveTemplateDefinition(syntax, templates);
    const atStart = uc.run(code, code.indexOf(ref)).at(0)?.origin;
    const atSlash = uc.run(code, code.indexOf(ref) + ref.indexOf('/')).at(0)?.origin;
    const atEnd = uc.run(code, code.indexOf(ref) + ref.length - 1).at(0)?.origin;
    assert.deepEqual(atStart, rangeOf(code, ref));
    assert.deepEqual(atSlash, atStart);
    assert.deepEqual(atEnd, atStart);
  });

  it('앞줄에 한글이 있어도 범위가 밀리지 않는다 — 컬럼은 UTF-16 기준이다', () => {
    const code = `<?php\n  $x = '한글 주석용 문자열'; echo $OUTPUT->render_from_template('local_ubattend/setting', $d);\n`;
    const ref = 'local_ubattend/setting';
    const found = new ResolveTemplateDefinition(syntax, templates).run(code, code.indexOf(ref) + 3);
    assert.ok(found.length > 0, '템플릿이 해석되어야 한다');
    assert.deepEqual(found[0].origin, rangeOf(code, ref));
  });

  it('JS의 언어 문자열 분기도 키를 범위로 잡는다', () => {
    const code = `import {get_string} from 'core/str';\nget_string('attendance_book', 'local_ubattend');\n`;
    const found = new ResolveJsDefinition(strings, templates).run(code, code.indexOf('attendance_book') + 2);
    assert.ok(found.length > 0, 'JS 문자열이 해석되어야 한다');
    assert.deepEqual(found[0].origin, rangeOf(code, 'attendance_book'));
  });

  it('mustache의 언어 문자열 분기도 키를 범위로 잡는다', () => {
    const code = `<p>{{#str}}attendance_book, local_ubattend{{/str}}</p>\n`;
    const found = new ResolveMustacheDefinition(templates, strings).run(code, code.indexOf('attendance_book') + 2);
    assert.ok(found.length > 0, 'mustache 문자열이 해석되어야 한다');
    assert.deepEqual(found[0].origin, rangeOf(code, 'attendance_book'));
  });
});
