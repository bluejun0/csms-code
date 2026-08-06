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

describe('IndexStore — 비동기 빌드·증분', () => {
  it('async 빌드가 sync와 동일 결과', async () => {
    const a = new IndexStore(); a.buildFromRoot(root);
    const b = new IndexStore(); await b.buildFromRootAsync(root);
    assert.deepEqual(b.allTableNames().sort(), a.allTableNames().sort());
  });
  it('진행률 콜백이 최소 1회 호출되고 done ≤ total', async () => {
    const s = new IndexStore();
    const calls: [number, number][] = [];
    await s.buildFromRootAsync(root, (d, t) => calls.push([d, t]));
    assert.ok(calls.length >= 1);
    assert.ok(calls.every(([d, t]) => d <= t));
  });
  it('removeFile 후 그 파일의 테이블만 사라진다', async () => {
    const s = new IndexStore(); await s.buildFromRootAsync(root);
    assert.ok(s.getTable('local_ubattend_config'), '사전 조건');
    s.removeFile(join(root, 'local/ubattend/db/install.xml'));
    assert.equal(s.getTable('local_ubattend_config'), undefined);
    assert.ok(s.getTable('block_testblock'), '다른 파일의 테이블은 남는다');
  });
  it('증분(remove→update)이 전체 재빌드와 같은 상태로 수렴', async () => {
    const s = new IndexStore(); await s.buildFromRootAsync(root);
    const file = join(root, 'local/ubattend/db/install.xml');
    s.removeFile(file);
    s.updateFile(file, 'local_ubattend');
    const full = new IndexStore(); await full.buildFromRootAsync(root);
    assert.deepEqual(s.allTableNames().sort(), full.allTableNames().sort());
  });
});
