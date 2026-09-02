import { strict as assert } from 'assert';
import { join } from 'path';
import { IndexStore } from '../../../src/infrastructure/indexing/index-store';
import { PhpUsageIndex } from '../../../src/infrastructure/usage/php-usage-index';
import { FindTableReferences } from '../../../src/application/find-table-references';
import { LocateTableTarget } from '../../../src/application/locate-table-target';

const root = join(__dirname, '../../fixtures/mini-moodle');
const installXml = join(root, 'local/ubattend/db/install.xml');

describe('테이블 사용처 유스케이스', () => {
  const store = new IndexStore();
  store.buildFromRoot(root);
  const usages = new PhpUsageIndex(() => true);
  usages.updateFileText('/u.php', "<?php\n$DB->insert_record('local_ubattend_config', $d);\n$x = $DB->get_records_sql('SELECT * FROM {local_ubattend_config}');\n");

  it('install.xml의 TABLE 줄 → 대상, 다른 줄은 null', () => {
    const locate = new LocateTableTarget(store);
    assert.deepEqual(locate.installXml(installXml, 2), { name: 'local_ubattend_config' });
    assert.equal(locate.installXml(installXml, 0), null, 'XMLDB 줄은 대상이 아니다');
    assert.equal(locate.installXml(installXml, 4), null, 'FIELD 줄은 대상이 아니다(테이블 이름만)');
    assert.equal(locate.installXml('/other/db/install.xml', 2), null);
  });
  it('사용처: DML 호출 + SQL 참조, 선언 포함이면 install.xml 위치가 함께', () => {
    const find = new FindTableReferences(usages, store);
    assert.equal(find.run('local_ubattend_config').length, 2);
    const withDecl = find.run('local_ubattend_config', true);
    assert.equal(withDecl.length, 3);
    assert.equal(withDecl[0].uri, installXml);
    assert.equal(withDecl[0].line, 2);
  });
  it('색인에 없는 테이블 → 빈 목록', () =>
    assert.deepEqual(new FindTableReferences(usages, store).run('nope', true), []));
});
