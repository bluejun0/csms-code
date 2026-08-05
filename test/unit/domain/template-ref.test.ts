import { strict as assert } from 'assert';
import { parseTemplateRef } from '../../../src/domain/template-model/template-ref';

describe('parseTemplateRef', () => {
  it('component/name 분해', () =>
    assert.deepEqual(parseTemplateRef('local_ubattend/setting'), { component: 'local_ubattend', name: 'setting' }));
  it('하위 경로는 name에 통째로', () =>
    assert.deepEqual(parseTemplateRef('local_ubattend/svg/icon/hyflex'), { component: 'local_ubattend', name: 'svg/icon/hyflex' }));
  it('슬래시 없음 → null', () => assert.equal(parseTemplateRef('setting'), null));
  it('앞뒤 슬래시만 → null', () => {
    assert.equal(parseTemplateRef('/setting'), null);
    assert.equal(parseTemplateRef('local_ubattend/'), null);
  });
});
