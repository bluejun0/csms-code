import { strict as assert } from 'assert';
import { join } from 'path';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/tree-sitter/tree-sitter-php-syntax';
import { ConfigKeyIndex } from '../../../src/infrastructure/config/config-key-index';
import { PhpUsageIndex } from '../../../src/infrastructure/usage/php-usage-index';
import { clearPluginTypeCache } from '../../../src/infrastructure/workspace/plugin-type-map';
import { LocateConfigTarget } from '../../../src/application/locate-config-target';
import { ResolveConfigDefinition } from '../../../src/application/resolve-config-definition';
import { DescribeConfigKey } from '../../../src/application/describe-config-key';
import { FindConfigReferences } from '../../../src/application/find-config-references';
import { ListResolvedConfigRefs } from '../../../src/application/list-resolved-config-refs';
import { CompleteConfigKeys } from '../../../src/application/complete-config-keys';

const root = join(__dirname, '../../fixtures/mini-moodle');
const settingsFile = join(root, 'local/ubattend/settings.php');
const CODE = `<?php
class z {
  public $pluginname = 'local_ubattend';
  function f() {
    $a = get_config('local_ubattend', 'apikey');
    set_config('mode', 1, 'local_ubattend');
    $b = get_config($this->pluginname, 'attendlimit');
    $c = get_config('local_ubattend', 'nope');
    $d = get_config('mod_ubattend', 'apikey');
  }
}
`;

describe('설정 키 유스케이스 (E2E)', () => {
  let syn: TreeSitterPhpSyntax;
  const configs = new ConfigKeyIndex();
  const usages = new PhpUsageIndex(() => false);
  before(async () => {
    clearPluginTypeCache();
    syn = await TreeSitterPhpSyntax.create();
    await configs.buildFromRootAsync(root);
    usages.updateFileText('/z.php', CODE);
  });
  const at = (needle: string) => CODE.indexOf(needle) + 1;

  it('위치→대상: 리터럴·전파, 키 밖이면 null, settings.php는 선언 줄로', () => {
    const locate = new LocateConfigTarget(syn, configs);
    assert.deepEqual(locate.php(CODE, at("'apikey'")), { plugin: 'local_ubattend', key: 'apikey' });
    assert.deepEqual(locate.php(CODE, at("'attendlimit'")), { plugin: 'local_ubattend', key: 'attendlimit' });
    assert.equal(locate.php(CODE, at("'local_ubattend', 'apikey'")), null, '플러그인 인자 위는 아님');
    const declLine = configs.declaration('local_ubattend', 'apikey')!.location.line;
    assert.deepEqual(locate.settings(settingsFile, declLine), { plugin: 'local_ubattend', key: 'apikey' });
    assert.equal(locate.settings(settingsFile, 0), null);
  });
  it('정의 이동: settings.php 선언 줄, 모르는 키·다른 플러그인은 []', () => {
    const r = new ResolveConfigDefinition(syn, configs);
    const [d] = r.run(CODE, at("'apikey'"));
    assert.equal(d.location.uri, settingsFile);
    assert.deepEqual(r.run(CODE, at("'nope'")), []);
    assert.deepEqual(r.run(CODE, CODE.lastIndexOf("'apikey'") + 1), [], 'mod_ubattend/apikey는 선언이 없다');
  });
  it('hover: plugin/key·설정 클래스·상대 경로 + config 대상', () => {
    const h = new DescribeConfigKey(syn, configs, uri => uri.replace(root + '/', '')).run(CODE, at("'mode'"))!;
    assert.match(h.markdown, /\*\*local_ubattend \/ mode\*\*/);
    assert.match(h.markdown, /admin_setting_configselect/);
    assert.match(h.markdown, /local\/ubattend\/settings\.php:\d+/);
    assert.deepEqual(h.target, { kind: 'config', component: 'local_ubattend', key: 'mode' });
  });
  it('참조: 사용처(+선언)', () => {
    const f = new FindConfigReferences(usages, configs);
    assert.equal(f.run('local_ubattend', 'apikey').length, 1);
    const withDecl = f.run('local_ubattend', 'apikey', true);
    assert.equal(withDecl.length, 2);
    assert.equal(withDecl[0].uri, settingsFile);
    const undeclared = f.run('local_ubattend', 'nope', true);
    assert.equal(undeclared.length, 1, '선언이 없어도 호출은 사용처다 — 선언만 빠진다');
    assert.equal(undeclared[0].uri, '/z.php');
    assert.deepEqual(f.run('local_ubattend', 'zzz', true), [], '선언도 사용처도 없음');
  });
  it('하이라이트: 선언이 있는 키만(전파 포함)', () => {
    const l = new ListResolvedConfigRefs(syn, configs);
    assert.deepEqual(l.run(CODE).map(r => r.length).sort(), ['apikey'.length, 'attendlimit'.length, 'mode'.length].sort());
    assert.equal(l.hasCalls(CODE), true);
    assert.equal(l.hasCalls('<?php echo 1;'), false);
  });
  it('완성: 플러그인의 선언된 키(heading 제외)와 설정 클래스', () => {
    const items = new CompleteConfigKeys(configs).run('local_ubattend');
    assert.deepEqual(items.map(i => i.key).sort(), ['apikey', 'attendlimit', 'mode']);
    assert.equal(items.find(i => i.key === 'mode')!.settingClass, 'admin_setting_configselect');
  });
});
