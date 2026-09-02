import { strict as assert } from 'assert';
import { join } from 'path';
import * as fs from 'fs';
import * as os from 'os';
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
    // 이름만 비교하면 component 오라벨을 놓친다 — 테이블 정체성(이름·컴포넌트·필드)까지 비교
    const dump = (x: IndexStore) => x.allTableNames().sort().map(n => {
      const t = x.getTable(n)!;
      return `${t.name}|${t.component}|${t.fieldNames().join(',')}`;
    });
    assert.deepEqual(dump(s), dump(full));
  });
  it('파일 201개 합성 루트에서 200파일 양보·진행률 분기가 실제로 실행된다', async () => {
    const tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-yield-'));
    try {
      // Moodle 루트 최소 조건 + local 플러그인 201개(각각 db/install.xml 1개)
      fs.mkdirSync(join(tmp, 'lib', 'db'), { recursive: true });
      fs.writeFileSync(join(tmp, 'version.php'), '<?php');
      fs.writeFileSync(join(tmp, 'lib', 'db', 'install.xml'), '<XMLDB><TABLES></TABLES></XMLDB>');
      for (let i = 0; i < 201; i++) {
        const d = join(tmp, 'local', `t${i}`, 'db');
        fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(join(d, 'install.xml'),
          `<XMLDB><TABLES><TABLE NAME="table_${i}"><FIELDS><FIELD NAME="id" TYPE="int"/></FIELDS></TABLE></TABLES></XMLDB>`);
      }
      const s = new IndexStore();
      const calls: [number, number][] = [];
      await s.buildFromRootAsync(tmp, (d, t) => calls.push([d, t]));
      assert.ok(calls.some(([d]) => d === 200), '200번째 파일에서 루프 내 진행률이 발화(양보 분기 실행)');
      assert.ok(calls.length >= 2, '루프 내 양보 1회 이상 + 완료 1회');
      assert.ok(calls.every(([d, t]) => d <= t), 'done ≤ total 항상 참');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('IndexStore — 파일별 테이블 조회', () => {
  it('tablesIn: 그 install.xml이 선언한 테이블만, 다른 파일은 빈 배열', () => {
    const s = new IndexStore();
    s.buildFromRoot(join(__dirname, '../../fixtures/mini-moodle'));
    const file = join(__dirname, '../../fixtures/mini-moodle/local/ubattend/db/install.xml');
    assert.deepEqual(s.tablesIn(file).map(t => t.name), ['local_ubattend_config']);
    assert.equal(s.tablesIn(join(__dirname, '../../fixtures/mini-moodle/nope/db/install.xml')).length, 0);
    assert.equal(s.tablesIn(file)[0].location.line, 2, 'TABLE 줄(0-based)');
  });
});
