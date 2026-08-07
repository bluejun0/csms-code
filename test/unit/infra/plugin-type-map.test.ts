import { strict as assert } from 'assert';
import { join } from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  STATIC_PLUGIN_DIRS, pluginTypeDirs, pluginTypeDirsAsync, coreSubsystemDirs, clearPluginTypeCache,
} from '../../../src/infrastructure/workspace/plugin-type-map';

const root = join(__dirname, '../../fixtures/subplugin-moodle');
const mini = join(__dirname, '../../fixtures/mini-moodle');
const staticEntries = () => Object.entries(STATIC_PLUGIN_DIRS).sort();

describe('pluginTypeDirs', () => {
  beforeEach(() => clearPluginTypeCache());

  it('선언 파일이 없으면 정적 맵과 같다', () => {
    const tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-types-'));
    assert.deepEqual([...pluginTypeDirs(tmp)].sort(), staticEntries());
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('subplugins.json의 타입을 더한다', () => {
    assert.equal(pluginTypeDirs(root).get('testsub'), 'mod/testmod/sub');
  });

  it('subplugins.php의 리터럴 쌍도 읽는다', () => {
    assert.equal(pluginTypeDirs(root).get('testold'), 'blocks/testblock/old');
  });

  it('정적 맵의 타입은 모두 유지된다(선언이 덮어쓴 것 제외)', () => {
    const map = pluginTypeDirs(root);
    for (const [t, d] of Object.entries(STATIC_PLUGIN_DIRS)) {
      assert.ok(map.has(t), `${t} 유지되어야 함`);
      if (t !== 'report') assert.equal(map.get(t), d, `${t}의 디렉터리가 바뀌면 안 된다`);
    }
  });

  it('선언이 정적 맵을 이긴다', () => {
    assert.equal(pluginTypeDirs(root).get('report'), 'custom/report');
  });

  it('mini-moodle은 정적 맵과 동일하다', () => {
    assert.deepEqual([...pluginTypeDirs(mini)].sort(), staticEntries());
  });

  it('동기 ≡ 비동기', async () => {
    const s = [...pluginTypeDirs(root)].sort();
    clearPluginTypeCache();
    const a = [...await pluginTypeDirsAsync(root)].sort();
    assert.deepEqual(a, s);
  });

  it('캐시: 같은 루트를 다시 구성하지 않는다', () => {
    const tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-cache-'));
    fs.mkdirSync(join(tmp, 'lib'), { recursive: true });
    fs.writeFileSync(join(tmp, 'lib', 'components.json'), JSON.stringify({ plugintypes: { zzz: 'zzz' } }));
    assert.ok(pluginTypeDirs(tmp).has('zzz'));
    fs.rmSync(join(tmp, 'lib', 'components.json'));
    assert.ok(pluginTypeDirs(tmp).has('zzz'), '캐시가 유지되어야 한다');
    clearPluginTypeCache(tmp);
    assert.ok(!pluginTypeDirs(tmp).has('zzz'), '캐시를 비우면 다시 읽는다');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('파손된 JSON·리터럴 없는 php는 무시한다', () => {
    const tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-bad-'));
    fs.mkdirSync(join(tmp, 'lib'), { recursive: true });
    fs.writeFileSync(join(tmp, 'lib', 'components.json'), '{ not json');
    fs.mkdirSync(join(tmp, 'local', 'x', 'db'), { recursive: true });
    fs.writeFileSync(join(tmp, 'local', 'x', 'db', 'subplugins.php'),
      '<?php $subplugins = (array) json_decode(file_get_contents($CFG->dirroot."/x.json"))->plugintypes;');
    assert.deepEqual([...pluginTypeDirs(tmp)].sort(), staticEntries());
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('php 선언의 라이선스 헤더는 타입으로 잡히지 않는다', () => {
    const tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-hdr-'));
    fs.mkdirSync(join(tmp, 'local', 'x', 'db'), { recursive: true });
    fs.writeFileSync(join(tmp, 'local', 'x', 'db', 'subplugins.php'),
      "<?php\n// @license 'gpl' => 'v3'\n$subplugins = array('realtype' => 'local/x/sub');\n");
    const map = pluginTypeDirs(tmp);
    assert.equal(map.get('realtype'), 'local/x/sub');
    assert.ok(!map.has('gpl'), '헤더의 따옴표 쌍이 타입이 되면 안 된다');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('서브플러그인이 선언한 서브플러그인도 찾는다', () => {
    const tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-deep-'));
    fs.mkdirSync(join(tmp, 'local', 'a', 'db'), { recursive: true });
    fs.writeFileSync(join(tmp, 'local', 'a', 'db', 'subplugins.json'),
      JSON.stringify({ plugintypes: { lvl1: 'local/a/one' } }));
    fs.mkdirSync(join(tmp, 'local', 'a', 'one', 'b', 'db'), { recursive: true });
    fs.writeFileSync(join(tmp, 'local', 'a', 'one', 'b', 'db', 'subplugins.json'),
      JSON.stringify({ plugintypes: { lvl2: 'local/a/one/b/two' } }));
    const map = pluginTypeDirs(tmp);
    assert.equal(map.get('lvl1'), 'local/a/one');
    assert.equal(map.get('lvl2'), 'local/a/one/b/two');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('coreSubsystemDirs', () => {
  beforeEach(() => clearPluginTypeCache());

  it('null 값은 제외하고 읽는다', () => {
    const m = coreSubsystemDirs(root);
    assert.equal(m.get('form'), 'lib/form');
    assert.ok(!m.has('access'));
  });

  it('components.json이 없으면 빈 Map', () => {
    const tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-nosub-'));
    assert.equal(coreSubsystemDirs(tmp).size, 0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
