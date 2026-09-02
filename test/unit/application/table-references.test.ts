import { strict as assert } from 'assert';
import { join } from 'path';
import { IndexStore } from '../../../src/infrastructure/indexing/index-store';
import { PhpUsageIndex } from '../../../src/infrastructure/usage/php-usage-index';
import { FindTableReferences } from '../../../src/application/find-table-references';
import { LocateTableTarget } from '../../../src/application/locate-table-target';
import { Table } from '../../../src/domain/moodle-model/table';
import { TableRepository } from '../../../src/domain/moodle-model/ports/table-repository';

const root = join(__dirname, '../../fixtures/mini-moodle');
const installXml = join(root, 'local/ubattend/db/install.xml');

describe('테이블 사용처 유스케이스', () => {
  const store = new IndexStore();
  store.buildFromRoot(root);
  const usages = new PhpUsageIndex(() => true);
  usages.updateFileText('/u.php', "<?php\n$DB->insert_record('local_ubattend_config', $d);\n$x = $DB->get_records_sql('SELECT * FROM {local_ubattend_config}');\necho 'index.php?id={course}';\n");

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
  it('색인에는 있지만 선언에 없는 이름 → 빈 목록(걸러내지 않는 설계가 오탐을 내지 않는 이유)', () => {
    assert.equal(usages.tableRefsOf('course').length, 1, '비SQL 중괄호도 색인에는 담긴다');
    assert.deepEqual(new FindTableReferences(usages, store).run('course', true), [], '선언이 없으면 목록에 나오지 않는다');
  });
  it('여러 TABLE이 든 install.xml에서 줄마다 그 테이블로 판정', () => {
    const at = (line: number) => ({ uri: '/x/db/install.xml', line, column: 4 });
    const t = (name: string, line: number) => new Table(name, 'local_x', [], at(line));
    const fake: TableRepository = {
      getTable: () => undefined,
      allTableNames: () => [],
      tablesIn: f => f === '/x/db/install.xml' ? [t('local_x_a', 2), t('local_x_b', 8)] : [],
    };
    const locate = new LocateTableTarget(fake);
    assert.deepEqual(locate.installXml('/x/db/install.xml', 2), { name: 'local_x_a' });
    assert.deepEqual(locate.installXml('/x/db/install.xml', 8), { name: 'local_x_b' });
    assert.equal(locate.installXml('/x/db/install.xml', 5), null, '두 선언 사이의 줄은 대상이 아니다');
  });
  it('색인에 없는 테이블 → 빈 목록', () =>
    assert.deepEqual(new FindTableReferences(usages, store).run('nope', true), []));
});
