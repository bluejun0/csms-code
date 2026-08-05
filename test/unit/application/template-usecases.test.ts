import { strict as assert } from 'assert';
import { join } from 'path';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/tree-sitter/tree-sitter-php-syntax';
import { TemplateIndex } from '../../../src/infrastructure/templates/template-index';
import { ResolveTemplateDefinition } from '../../../src/application/resolve-template-definition';
import { FindTemplateReferences } from '../../../src/application/find-template-references';
import { ListResolvedTemplateCalls } from '../../../src/application/list-resolved-template-calls';

const root = join(__dirname, '../../fixtures/mini-moodle');
const tpl = new TemplateIndex();
tpl.buildFromRoot(root);

const CODE = `<?php
function r() {
  echo $OUTPUT->render_from_template('local_ubattend/setting', $d);
  echo $OUTPUT->render_from_template('local_ubattend/nope', $d);
  echo $OUTPUT->render_from_template('bare_no_slash', $d);
}
`;

describe('템플릿 유즈케이스 (E2E)', () => {
  it('정의 이동: 원본 + 테마 오버라이드 둘 다', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const at = CODE.indexOf('local_ubattend/setting') + 3;
    const locs = new ResolveTemplateDefinition(syn, tpl).run(CODE, at);
    assert.equal(locs.length, 2);
    assert.ok(locs.every(l => l.location.uri.endsWith('setting.mustache')));
  });
  it('정의 이동: 커서가 ref 밖이면 빈 배열', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    assert.deepEqual(new ResolveTemplateDefinition(syn, tpl).run(CODE, CODE.indexOf('function r')), []);
  });
  it('정의 이동: 색인에 없는 템플릿은 빈 배열', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const at = CODE.indexOf('local_ubattend/nope') + 3;
    assert.deepEqual(new ResolveTemplateDefinition(syn, tpl).run(CODE, at), []);
  });
  it('해석 범위: 존재하는 ref만(슬래시 없는 ref·미존재 제외)', async () => {
    const syn = await TreeSitterPhpSyntax.create();
    const r = new ListResolvedTemplateCalls(syn, tpl).run(CODE);
    assert.equal(r.length, 1);
    assert.equal(r[0].length, 'local_ubattend/setting'.length);
    assert.equal(r[0].line, 2);
  });
  it('참조 조회: 포트 위임', () => {
    const fake = { templateRefsOf: (c: string, n: string) => [{ uri: `${c}::${n}`, line: 0, column: 0 }] };
    assert.equal(new FindTemplateReferences(fake).run('local_ubattend', 'setting')[0].uri, 'local_ubattend::setting');
  });
});
