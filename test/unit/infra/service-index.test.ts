import { strict as assert } from 'assert';
import { join } from 'path';
import { ServiceIndex } from '../../../src/infrastructure/services/service-index';
import { componentOfServicesFile } from '../../../src/infrastructure/workspace/moodle-root-resolver';

const root = join(__dirname, '../../fixtures/mini-moodle');
const idx = new ServiceIndex();
idx.buildFromRoot(root); // 동기 — 모듈 로드 시 1회

describe('ServiceIndex', () => {
  it('services.php를 가진 컴포넌트를 이름순으로 준다', () =>
    assert.deepEqual(idx.components(), ['block_testblock', 'local_ubattend']));

  it('컴포넌트의 함수를 선언 순서대로 준다', () =>
    assert.deepEqual(idx.functionsOf('local_ubattend').map(f => f.name),
      ['local_ubattend_get_sessions', 'local_ubattend_save_attendance']));

  it('선언 줄과 컴포넌트를 함수에 붙인다', () => {
    const fn = idx.functionsOf('local_ubattend')[1];
    assert.equal(fn.component, 'local_ubattend');
    assert.equal(fn.location.line, 11, '선언 줄(0-based)');
    assert.equal(fn.location.uri, join(root, 'local/ubattend/db/services.php'));
  });

  it('설명과 read/write를 보존한다', () => {
    const fn = idx.functionsOf('local_ubattend')[0];
    assert.equal(fn.description, '출석 세션 목록');
    assert.equal(fn.type, 'read');
    assert.equal(fn.classname, 'local_ubattend\\external\\Session');
    assert.equal(fn.methodname, 'get_sessions');
  });

  it('array() 문법 파일도 색인한다', () =>
    assert.deepEqual(idx.functionsOf('block_testblock').map(f => f.name), ['block_testblock_ping']));

  it('services.php가 없는 컴포넌트는 빈 배열', () =>
    assert.deepEqual(idx.functionsOf('core'), []));

  it('size는 함수 총수', () => assert.equal(idx.size(), 3));
});

describe('ServiceIndex — 비동기 빌드·증분', () => {
  it('async 빌드가 sync와 동일 결과', async () => {
    const a = new ServiceIndex(); a.buildFromRoot(root);
    const b = new ServiceIndex(); await b.buildFromRootAsync(root);
    const dump = (x: ServiceIndex) => x.components().map(c => `${c}:${x.functionsOf(c).map(f => f.name).join(',')}`);
    assert.deepEqual(dump(b), dump(a));
  });

  it('파일을 지우면 그 컴포넌트가 사라진다', () => {
    const s = new ServiceIndex(); s.buildFromRoot(root);
    s.removeFile(join(root, 'blocks/testblock/db/services.php'));
    assert.deepEqual(s.components(), ['local_ubattend']);
  });

  it('파일 하나만 다시 읽어도 전체 빌드와 같다', () => {
    const file = join(root, 'local/ubattend/db/services.php');
    const s = new ServiceIndex(); s.buildFromRoot(root);
    s.removeFile(file);
    s.updateFile(file, 'local_ubattend');
    const full = new ServiceIndex(); full.buildFromRoot(root);
    const dump = (x: ServiceIndex) => x.components().map(c => `${c}:${x.functionsOf(c).map(f => f.name).join(',')}`);
    assert.deepEqual(dump(s), dump(full));
  });
});

describe('componentOfServicesFile', () => {
  it('플러그인의 db/services.php → frankenstyle', () =>
    assert.equal(componentOfServicesFile(root, join(root, 'local/ubattend/db/services.php')), 'local_ubattend'));
  it('코어의 lib/db/services.php → core', () =>
    assert.equal(componentOfServicesFile(root, join(root, 'lib/db/services.php')), 'core'));
  it('db 밖의 services.php는 규칙 밖', () =>
    assert.equal(componentOfServicesFile(root, join(root, 'local/ubattend/services.php')), null));
  it('루트 밖은 규칙 밖', () =>
    assert.equal(componentOfServicesFile(root, '/elsewhere/db/services.php'), null));
});
