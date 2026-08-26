import { strict as assert } from 'assert';
import { configPlugin, configKeyId } from '../../../src/domain/moodle-model/services/config-plugin';

describe('configPlugin — 설정 plugin은 저장 키 그대로', () => {
  it("''·moodle·core → core", () => {
    for (const r of ['', 'moodle', 'core']) assert.equal(configPlugin(r), 'core');
  });
  it('bare 이름도 그대로 — ubboard와 mod_ubboard는 다른 행', () => {
    assert.equal(configPlugin('ubboard'), 'ubboard');
    assert.equal(configPlugin('mod_ubboard'), 'mod_ubboard');
  });
  it('configKeyId는 plugin/key', () => assert.equal(configKeyId('moodle', 'x'), 'core/x'));
});
