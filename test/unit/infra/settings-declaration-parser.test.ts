import { strict as assert } from 'assert';
import { parseSettingDeclarations } from '../../../src/infrastructure/config/settings-declaration-parser';

const TEXT = `<?php
$pluginname = 'local_csmsmedia';
$settings->add(new admin_setting_configtext('local_csmsmedia/uploadurl', 'a', 'b', ''));
$name = $pluginname . '/organization_code';
$title = get_string('organization_code', $pluginname);
$setting = new admin_setting_configtext($name, $title, '', '');
$name = 'local_csmsmedia/drm_site_id';
$setting = new admin_setting_configpasswordunmask($name, $title, '', '');
$name = "$pluginname/token";
$setting = new admin_setting_configtext($name, $title, '', '');
$setting = new admin_setting_configcheckbox($pluginname . '/enabled', $title, '', 0);
$settings->add(new admin_setting_heading('local_csmsmedia/head', 'h', ''));
$settings->add(new admin_setting_configselect('sitepolicy', 'x', 'y', 0, []));
$temp->add(new admin_settings_num_course_sections('moodlecourse/numsections', 'n', 'd', 4));
$unknown = some_function();
$setting = new admin_setting_configtext($unknown, $title, '', '');
class special extends admin_setting_configmulticheckbox {
  public function __construct() { parent::__construct('gradebookroles', 'x', 'y', null, null); }
}
`;

describe('parseSettingDeclarations — settings.php 관용구', () => {
  const decls = parseSettingDeclarations('/m/local/csmsmedia/settings.php', TEXT);
  const byKey = (k: string) => decls.find(d => d.key === k);

  it('리터럴 plugin/key', () => {
    const d = byKey('uploadurl')!;
    assert.equal(d.plugin, 'local_csmsmedia');
    assert.equal(d.settingClass, 'admin_setting_configtext');
  });
  it('$name = $pluginname . "/key" 연결 대입을 따라간다', () =>
    assert.equal(byKey('organization_code')?.plugin, 'local_csmsmedia'));
  it('$name = "p/k" 리터럴 재대입 — 가장 가까운 선행 대입', () =>
    assert.equal(byKey('drm_site_id')?.settingClass, 'admin_setting_configpasswordunmask'));
  it('"$pluginname/token" 보간', () => assert.equal(byKey('token')?.plugin, 'local_csmsmedia'));
  it('첫 인자에 바로 쓴 연결 $pluginname . "/enabled"', () => assert.equal(byKey('enabled')?.plugin, 'local_csmsmedia'));
  it('heading은 값이 없어 제외', () => assert.equal(byKey('head'), undefined));
  it('슬래시 없는 이름은 core', () => assert.equal(byKey('sitepolicy')?.plugin, 'core'));
  it('복수형 클래스명(admin_settings_*)도 선언', () =>
    assert.equal(byKey('numsections')?.settingClass, 'admin_settings_num_course_sections'));
  it('값을 모르는 변수는 침묵', () =>
    assert.equal(decls.filter(d => d.plugin === 'core').length, 2, 'sitepolicy·gradebookroles만'));
  it('parent::__construct 리터럴은 core 선언', () => assert.equal(byKey('gradebookroles')?.plugin, 'core'));
  it('위치는 new 줄과 첫 인자 컬럼', () => {
    const d = byKey('organization_code')!;
    const line = TEXT.split('\n')[d.location.line];
    assert.match(line, /new admin_setting_configtext\(\$name/);
    assert.equal(line.slice(d.location.column, d.location.column + 5), '$name');
    assert.equal(d.location.uri, '/m/local/csmsmedia/settings.php');
  });
  it('같은 (plugin, key)가 두 번이면 먼저 것', () => {
    const two = parseSettingDeclarations('/f', "<?php\nnew admin_setting_configtext('a/k', '', '', '');\nnew admin_setting_configselect('a/k', '', '', 0, []);\n");
    assert.equal(two.length, 1);
    assert.equal(two[0].settingClass, 'admin_setting_configtext');
  });
});
