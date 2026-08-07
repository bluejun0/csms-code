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

  it('없는 키는 undefined', () => assert.equal(idx.find('nope_key'), undefined));

  it('keys()가 모은 전부를 준다', () => {
    const names = idx.keys().map(k => k.name);
    assert.ok(names.includes('wwwroot') && names.includes('attendlimit'));
    assert.equal(new Set(names).size, names.length, '중복 없음');
  });
});
