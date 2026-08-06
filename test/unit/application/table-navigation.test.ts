import { strict as assert } from 'assert';
import { join } from 'path';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/tree-sitter/tree-sitter-php-syntax';
import { IndexStore } from '../../../src/infrastructure/indexing/index-store';
import { ResolveTableDefinition } from '../../../src/application/resolve-table-definition';
import { ListResolvedTableRefs } from '../../../src/application/list-resolved-table-refs';

const root = join(__dirname, '../../fixtures/mini-moodle');
const store = new IndexStore();
store.buildFromRoot(root);

const CODE = `<?php
function q() {
  $a = 'SELECT * FROM {local_ubattend_config} WHERE id = ?';
  $b = "SELECT u.id FROM {user} u JOIN {no_such_table} n ON n.id = u.id";
  $c = '/^[0-9]{4}$/';
}
`;

describe('테이블 참조 유즈케이스 (E2E)', () => {
  let syn: TreeSitterPhpSyntax;
  before(async () => { syn = await TreeSitterPhpSyntax.create(); });

  it('정의 이동: 색인된 테이블의 install.xml TABLE 줄로', () => {
    const at = CODE.indexOf('local_ubattend_config') + 3;
    const locs = new ResolveTableDefinition(syn, store).run(CODE, at);
    assert.equal(locs.length, 1);
    assert.ok(locs[0].location.uri.endsWith(join('local', 'ubattend', 'db', 'install.xml')));
    const table = store.getTable('local_ubattend_config')!;
    assert.equal(locs[0].location.line, table.location.line);
  });

  it('정의 이동: 이름 첫 문자와 마지막 문자에서 모두 해석', () => {
    const start = CODE.indexOf('{user}') + 1;
    const uc = new ResolveTableDefinition(syn, store);
    assert.equal(uc.run(CODE, start).length, 1);
    assert.equal(uc.run(CODE, start + 'user'.length).length, 1);
  });

  it('정의 이동: 이름 범위 앞뒤 밖이면 빈 배열', () => {
    const start = CODE.indexOf('{user}') + 1;
    const uc = new ResolveTableDefinition(syn, store);
    assert.deepEqual(uc.run(CODE, start - 1), []);
    assert.deepEqual(uc.run(CODE, start + 'user'.length + 1), []);
  });

  it('정의 이동: 색인에 없는 이름은 빈 배열', () => {
    const uc = new ResolveTableDefinition(syn, store);
    assert.deepEqual(uc.run(CODE, CODE.indexOf('no_such_table') + 3), []);
    assert.deepEqual(uc.run(CODE, CODE.indexOf('{4}') + 1), []);
  });

  it('해석 범위: 색인된 참조만, 길이는 이름 길이', () => {
    const ranges = new ListResolvedTableRefs(syn, store).run(CODE);
    assert.deepEqual(ranges, [
      { line: 2, column0: CODE.split('\n')[2].indexOf('local_ubattend_config'), length: 'local_ubattend_config'.length },
      { line: 3, column0: CODE.split('\n')[3].indexOf('user'), length: 4 },
    ]);
  });
});
