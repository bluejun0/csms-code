import { strict as assert } from 'assert';
import { join } from 'path';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/tree-sitter/tree-sitter-php-syntax';
import { IndexStore } from '../../../src/infrastructure/indexing/index-store';
import { ClassMemberIndex } from '../../../src/infrastructure/coreapi/class-member-index';
import { ConfigKeyIndex } from '../../../src/infrastructure/config/config-key-index';
import { CompleteGlobalMembers } from '../../../src/application/complete-global-members';
import { DescribeGlobalMember } from '../../../src/application/describe-global-member';
import { ResolveGlobalMemberDefinition } from '../../../src/application/resolve-global-member-definition';
import { clearPluginTypeCache } from '../../../src/infrastructure/workspace/plugin-type-map';

const root = join(__dirname, '../../fixtures/mini-moodle');

const CODE = `<?php
function q() {
  global $DB, $CFG, $USER;
  $r = $DB->get_record('user', ['id' => 1]);
  echo $USER->username;
  echo $CFG->wwwroot;
  echo $DB->prefix;
}
function shadowedByForeach($users) {
  foreach ($users as $USER) { echo $USER->username; }
}
function shadowedByAssign() {
  $USER = build();
  echo $USER->username;
}
`;

describe('전역 유즈케이스 (E2E)', () => {
  let syn: TreeSitterPhpSyntax;
  let complete: CompleteGlobalMembers;
  let describe_: DescribeGlobalMember;
  let resolve: ResolveGlobalMemberDefinition;

  before(async () => {
    clearPluginTypeCache();
    syn = await TreeSitterPhpSyntax.create();
    const store = new IndexStore(); store.buildFromRoot(root);
    const classes = new ClassMemberIndex(); await classes.buildFromRoot(root, syn);
    const configs = new ConfigKeyIndex(); await configs.buildFromRootAsync(root);
    complete = new CompleteGlobalMembers(syn, classes, configs, store);
    describe_ = new DescribeGlobalMember(syn, classes, configs, store);
    resolve = new ResolveGlobalMemberDefinition(syn, classes, configs, store);
  });

  const at = (needle: string, offset = 1) => CODE.indexOf(needle) + offset;

  it('$DB-> 완성은 클래스 멤버를 준다', () => {
    const items = complete.run(CODE, 'DB', at('$DB->get_record'));
    assert.deepEqual(items.map(i => i.name).sort(), ['get_record', 'prefix', 'update_record']);
    const m = items.find(i => i.name === 'get_record')!;
    assert.equal(m.kind, 'method');
    assert.match(m.detail, /\$table/);
  });

  it('$USER-> 완성은 테이블 컬럼을 준다', () => {
    const items = complete.run(CODE, 'USER', at('$USER->username'));
    assert.ok(items.length > 0);
    assert.ok(items.every(i => i.kind === 'field'));
  });

  it('$CFG-> 완성은 설정 키를 준다', () => {
    const names = complete.run(CODE, 'CFG', at('$CFG->wwwroot')).map(i => i.name);
    assert.ok(names.includes('wwwroot'));
    assert.ok(names.includes('attendlimit'));
  });

  it('전역이 아닌 변수는 빈 결과', () => {
    assert.deepEqual(complete.run(CODE, 'r', at('$r =')), []);
  });

  it('foreach로 가려진 $USER는 전역 경로에서 빠진다', () => {
    const idx = CODE.indexOf('foreach ($users as $USER)');
    assert.deepEqual(complete.run(CODE, 'USER', idx + 20), []);
  });

  it('재대입으로 가려진 $USER도 빠진다', () => {
    const idx = CODE.indexOf('$USER = build();');
    assert.deepEqual(complete.run(CODE, 'USER', idx + 30), []);
  });

  it('hover: 메서드 이름 위', () => {
    const h = describe_.run(CODE, at('get_record(', 2));
    assert.ok(h, 'hover 결과가 있어야 한다');
    assert.match(h!.markdown, /moodle_database::get_record/);
    assert.match(h!.markdown, /레코드 하나를 가져온다/);
  });

  it('hover: 프로퍼티 이름 위(테이블·설정)', () => {
    const u = describe_.run(CODE, at('username', 2));
    assert.ok(u && /user\.username/.test(u.markdown), u?.markdown);
    const c = describe_.run(CODE, at('wwwroot', 2));
    assert.ok(c && /\$CFG->wwwroot/.test(c.markdown), c?.markdown);
    assert.match(c!.markdown, /사이트 주소/);
  });

  it('정의 이동: 클래스 파일·config-dist·install.xml로 각각', () => {
    const m = resolve.run(CODE, at('get_record(', 2));
    assert.equal(m.length, 1);
    assert.ok(m[0].location.uri.endsWith('moodle_database.php'));

    const c = resolve.run(CODE, at('wwwroot', 2));
    assert.equal(c.length, 1);
    assert.ok(c[0].location.uri.endsWith('config-dist.php'));

    const u = resolve.run(CODE, at('username', 2));
    assert.equal(u.length, 1);
    assert.ok(u[0].location.uri.endsWith('install.xml'));
  });

  it('정의 이동: 색인에 없는 멤버는 빈 배열', () => {
    const code = `<?php\nfunction z() { global $DB; $DB->no_such_method(); }\n`;
    assert.deepEqual(resolve.run(code, code.indexOf('no_such_method') + 2), []);
  });
});
