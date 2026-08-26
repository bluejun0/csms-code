import { strict as assert } from 'assert';
import { join } from 'path';
import * as fs from 'fs';
import { ConfigKeyIndex } from '../../../src/infrastructure/config/config-key-index';
import { clearPluginTypeCache } from '../../../src/infrastructure/workspace/plugin-type-map';

const root = join(__dirname, '../../fixtures/mini-moodle');

describe('ConfigKeyIndex', () => {
  let idx: ConfigKeyIndex;
  before(async () => {
    clearPluginTypeCache();
    idx = new ConfigKeyIndex();
    await idx.buildFromRootAsync(root);
  });

  it('config-dist.php의 키를 담는다', () => {
    assert.ok(idx.find('wwwroot'));
    assert.ok(idx.find('dataroot'));
    assert.ok(idx.find('admin'));
  });

  it('admin_setting 선언에서 키를 담고 plugin/key는 마지막 조각을 쓴다', () => {
    assert.ok(idx.find('attendlimit'), 'local_ubattend/attendlimit → attendlimit');
    assert.ok(idx.find('ubattend_simple'));
    assert.equal(idx.find('local_ubattend/attendlimit'), undefined, '통짜 이름은 키가 아니다');
  });

  it('config-dist의 주석을 설명으로 쓴다', () => {
    assert.equal(idx.find('wwwroot')!.doc, '사이트 주소.');
    assert.equal(idx.find('admin')!.doc, '', '주석이 없으면 빈 설명');
  });

  it('위치가 선언 줄과 컬럼을 가리킨다', () => {
    const k = idx.find('wwwroot')!;
    const line = fs.readFileSync(k.location.uri, 'utf8').split('\n')[k.location.line];
    assert.match(line, /wwwroot/);
    assert.equal(line.slice(k.location.column, k.location.column + 5), '$CFG-');
  });

  const settingsFile = join(root, 'local/ubattend/settings.php');
  it('(plugin, key) 선언 — 리터럴·$name 연결·$name 리터럴', () => {
    assert.equal(idx.declaration('local_ubattend', 'attendlimit')?.settingClass, 'admin_setting_configtext');
    assert.equal(idx.declaration('local_ubattend', 'apikey')?.settingClass, 'admin_setting_configtext');
    assert.equal(idx.declaration('local_ubattend', 'mode')?.settingClass, 'admin_setting_configselect');
    assert.equal(idx.declaration('local_ubattend', 'head'), undefined, 'heading 제외');
    assert.equal(idx.declaration('mod_ubattend', 'apikey'), undefined, '플러그인은 그대로 비교');
  });
  it('lib/adminlib.php의 parent::__construct → core', () =>
    assert.equal(idx.declaration('core', 'gradebookroles')?.plugin, 'core'));
  it('declarationsIn: 파일의 선언(슬래시 없는 것은 core로)', () => {
    const ds = idx.declarationsIn(settingsFile);
    assert.deepEqual(ds.map(d => `${d.plugin}/${d.key}`).sort(),
      ['core/ubattend_simple', 'local_ubattend/apikey', 'local_ubattend/attendlimit', 'local_ubattend/mode']);
    assert.ok(ds.every(d => d.location.uri === settingsFile));
  });
  it('keysOfPlugin: 그 플러그인만', () =>
    assert.deepEqual(idx.keysOfPlugin('local_ubattend').map(d => d.key).sort(), ['apikey', 'attendlimit', 'mode']));
  it('removeFile → 사라지고, updateFile → 돌아온다($CFG-> 납작 맵도 함께)', async () => {
    idx.removeFile(settingsFile);
    assert.equal(idx.declaration('local_ubattend', 'apikey'), undefined);
    assert.equal(idx.find('attendlimit'), undefined);
    await idx.updateFile(settingsFile);
    assert.ok(idx.declaration('local_ubattend', 'apikey'));
    assert.ok(idx.find('attendlimit'));
    assert.ok(idx.find('wwwroot'), 'config-dist는 영향 없음');
  });
  it('없는 키는 undefined', () => assert.equal(idx.find('nope_key'), undefined));

  it('keys()가 모은 전부를 준다', () => {
    const names = idx.keys().map(k => k.name);
    assert.ok(names.includes('wwwroot') && names.includes('attendlimit'));
    assert.equal(new Set(names).size, names.length, '중복 없음');
  });
});
