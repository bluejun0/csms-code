import { strict as assert } from 'assert';
import { join } from 'path';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/tree-sitter/tree-sitter-php-syntax';
import { AmdIndex } from '../../../src/infrastructure/amd/amd-index';
import { PhpUsageIndex } from '../../../src/infrastructure/usage/php-usage-index';
import { ResolveAmdDefinition } from '../../../src/application/resolve-amd-definition';
import { ListResolvedAmdCalls } from '../../../src/application/list-resolved-amd-calls';
import { FindAmdReferences } from '../../../src/application/find-amd-references';

const root = join(__dirname, '../../fixtures/mini-moodle');
const amd = new AmdIndex();
amd.buildFromRoot(root);

const CODE = `<?php
function p() {
  $PAGE->requires->js_call_amd('local_ubattend/setting', 'init');
  $PAGE->requires->js_call_amd('local_ubattend/sub/nested', 'init');
  $PAGE->requires->js_call_amd('local_ubattend/nope', 'init');
  $PAGE->requires->js_call_amd('bare_no_slash', 'init');
}
`;

describe('AMD 유즈케이스 (E2E)', () => {
  let syn: TreeSitterPhpSyntax;
  before(async () => { syn = await TreeSitterPhpSyntax.create(); });

  it('정의 이동: 색인된 모듈의 파일로', () => {
    const at = CODE.indexOf('local_ubattend/setting') + 3;
    const locs = new ResolveAmdDefinition(syn, amd).run(CODE, at);
    assert.equal(locs.length, 1);
    assert.ok(locs[0].location.uri.endsWith(join('amd', 'src', 'setting.js')));
  });

  it('정의 이동: 중첩 경로도 해석', () => {
    const at = CODE.indexOf('local_ubattend/sub/nested') + 3;
    const locs = new ResolveAmdDefinition(syn, amd).run(CODE, at);
    assert.equal(locs.length, 1);
    assert.ok(locs[0].location.uri.endsWith(join('amd', 'src', 'sub', 'nested.js')));
  });

  it('정의 이동: 없는 모듈·슬래시 없는 참조·ref 밖은 빈 배열', () => {
    const uc = new ResolveAmdDefinition(syn, amd);
    assert.deepEqual(uc.run(CODE, CODE.indexOf('local_ubattend/nope') + 3), []);
    assert.deepEqual(uc.run(CODE, CODE.indexOf('bare_no_slash') + 3), []);
    assert.deepEqual(uc.run(CODE, CODE.indexOf('function p')), []);
  });

  it('해석 범위: 색인된 참조만', () => {
    const r = new ListResolvedAmdCalls(syn, amd).run(CODE);
    assert.deepEqual(r.map(x => x.length),
      ['local_ubattend/setting'.length, 'local_ubattend/sub/nested'.length]);
    assert.equal(r[0].line, 2);
    assert.equal(r[0].column0, CODE.split('\n')[2].indexOf('local_ubattend/setting'));
  });

  it('사용처 참조: 포트 위임', () => {
    const usage = new PhpUsageIndex(() => true);
    usage.updateFileText('/w/local/x/index.php', CODE);
    const refs = new FindAmdReferences(usage).run('local_ubattend', 'setting');
    assert.equal(refs.length, 1);
    assert.equal(refs[0].line, 2);
  });
});
