import { strict as assert } from 'assert';
import { join } from 'path';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/tree-sitter/tree-sitter-php-syntax';
import { IndexStore } from '../../../src/infrastructure/indexing/index-store';
import { ClassMemberIndex } from '../../../src/infrastructure/coreapi/class-member-index';
import { ConfigKeyIndex } from '../../../src/infrastructure/config/config-key-index';
import { CompleteGlobalMembers } from '../../../src/application/complete-global-members';
import { CompleteRecordColumns } from '../../../src/application/complete-record-columns';
import { DescribeGlobalMember } from '../../../src/application/describe-global-member';
import { RecordTypeInference } from '../../../src/domain/code-analysis/record-type-inference';
import { clearPluginTypeCache } from '../../../src/infrastructure/workspace/plugin-type-map';

const root = join(__dirname, '../../fixtures/mini-moodle');

// Moodle 페이지 스크립트의 실제 모양 — 함수·클래스 밖에서 바로 쓰고, 중간에 HTML이 끼어든다.
const TOP = `<?php
require_once(__DIR__ . '/../../config.php');
require_login();

$config = $DB->get_record('local_ubattend_config', ['id' => 1]);
echo $USER->username;
echo $CFG->wwwroot;
echo $OUTPUT->header();
?>
<div>본문</div>
<?php
echo $config->courseid;

$rows = $DB->get_records('local_ubattend_config', []);
foreach ($rows as $r) {
  echo $r->courseid;
}

$config = build_other();
echo $config->courseid;
`;

describe('최상위 스크립트(함수·클래스 밖)', () => {
  let complete: CompleteGlobalMembers;
  let columns: CompleteRecordColumns;
  let describe_: DescribeGlobalMember;

  before(async () => {
    clearPluginTypeCache();
    const syn = await TreeSitterPhpSyntax.create();
    const store = new IndexStore(); store.buildFromRoot(root);
    const classes = new ClassMemberIndex(); await classes.buildFromRoot(root, syn);
    const configs = new ConfigKeyIndex(); await configs.buildFromRootAsync(root);
    complete = new CompleteGlobalMembers(syn, classes, configs, store);
    columns = new CompleteRecordColumns(syn, store, new RecordTypeInference());
    describe_ = new DescribeGlobalMember(syn, classes, configs, store);
  });

  const at = (needle: string, offset = 1) => TOP.indexOf(needle) + offset;

  it('$DB->·$OUTPUT-> 클래스 멤버가 나온다', () => {
    assert.ok(complete.run(TOP, 'DB', at('$DB->get_record')).some(i => i.name === 'get_record'));
    assert.ok(complete.run(TOP, 'OUTPUT', at('$OUTPUT->header')).some(i => i.name === 'header'));
  });

  it('$USER->·$CFG-> 도 나온다', () => {
    assert.ok(complete.run(TOP, 'USER', at('$USER->username')).some(i => i.name === 'username'));
    assert.ok(complete.run(TOP, 'CFG', at('$CFG->wwwroot')).some(i => i.name === 'wwwroot'));
  });

  it('최상위 대입에서 얻은 레코드의 컬럼이 나온다 — HTML 블록 뒤에서도', () => {
    const cols = columns.run(TOP, 'config', at('$config->courseid'));
    assert.ok(cols.some(c => c.name === 'courseid'), cols.map(c => c.name).join(','));
  });

  it('최상위 foreach 항목의 컬럼도 나온다', () => {
    assert.ok(columns.run(TOP, 'r', at('$r->courseid')).some(c => c.name === 'courseid'));
  });

  it('최상위 재대입 뒤에는 침묵한다(kill이 파일 스코프에서도 동작)', () => {
    const last = TOP.lastIndexOf('$config->courseid') + 1;
    assert.deepEqual(columns.run(TOP, 'config', last), []);
  });

  it('hover도 최상위에서 동작한다', () => {
    const h = describe_.run(TOP, at('username', 2));
    assert.ok(h && /user\.username/.test(h.markdown), h?.markdown);
  });

  it('전역이 최상위에서 재대입되면 전역 경로가 빠진다', () => {
    const code = `<?php\n$USER = $DB->get_record('user', ['id' => 2]);\necho $USER->username;\n`;
    assert.deepEqual(complete.run(code, 'USER', code.indexOf('echo $USER') + 6), []);
    assert.ok(columns.run(code, 'USER', code.indexOf('echo $USER') + 6).some(c => c.name === 'username'),
      '레코드 경로가 인수한다');
  });
});
