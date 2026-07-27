import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseInstallXml } from '../../../src/infrastructure/xmldb/xmldb-table-repository';

const xml = readFileSync(join(__dirname, '../../fixtures/mini-moodle/local/ubattend/db/install.xml'), 'utf8');

describe('parseInstallXml', () => {
  const tables = parseInstallXml(xml, '/x/install.xml', 'local_ubattend');
  const t = tables[0];
  it('테이블 1개, 이름', () => { assert.equal(tables.length, 1); assert.equal(t.name, 'local_ubattend_config'); });
  it('필드 3개', () => assert.deepEqual(t.fieldNames(), ['id', 'courseid', 'smart_status']));
  it('한국어 COMMENT', () => assert.equal(t.findField('courseid')?.comment, '강좌 고유번호'));
  it('type/notnull/default', () => {
    const c = t.findField('smart_status')!;
    assert.equal(c.type, 'int'); assert.equal(c.notnull, false); assert.equal(c.default, '2');
  });
  it('FIELD line 번호(0-based) 정확', () => {
    // courseid 는 파일에서 6번째 줄(index 5)
    assert.equal(t.findField('courseid')?.location.line, 5);
  });
});
