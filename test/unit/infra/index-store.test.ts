import { strict as assert } from 'assert';
import { join } from 'path';
import { IndexStore } from '../../../src/infrastructure/indexing/index-store';

const root = join(__dirname, '../../fixtures/mini-moodle');

describe('IndexStore', () => {
  const store = new IndexStore();
  store.buildFromRoot(root);
  it('코어 테이블 색인', () => assert.ok(store.getTable('user')));
  it('커스텀 테이블 색인', () => assert.ok(store.getTable('local_ubattend_config')));
  it('컬럼 접근', () =>
    assert.equal(store.getTable('local_ubattend_config')?.findField('courseid')?.comment, '강좌 고유번호'));
});
