import { strict as assert } from 'assert';
import { StringPool } from '../../../src/infrastructure/usage/string-pool';
import { extractUsages } from '../../../src/infrastructure/usage/extract-usages';

function extract(uri: string, text: string) {
  const pool = new StringPool();
  const file = pool.id(uri);
  const out = extractUsages(uri, text, { pool, file, hasCanonical: () => true });
  return { pool, out };
}

describe('extractUsages — PHP', () => {
  const SRC = `<?php
echo get_string('greet', 'local_x');
$OUTPUT->render_from_template('local_x/card', $c);
$PAGE->requires->js_call_amd('local_x/view', 'init');
echo get_config('local_x', 'apikey');
$sql = "SELECT * FROM {local_table}";
$DB->update_record('local_other', $r);
$DB->sql_like('col', '?');
`;

  it('문자열 호출을 id로 담는다', () => {
    const { pool, out } = extract('/a/b.php', SRC);
    const e = out.strings[0];
    assert.equal(pool.text(e.key), 'greet');
    assert.equal(pool.text(e.component), 'local_x');
    assert.equal(pool.text(e.file), '/a/b.php');
  });

  it('템플릿·AMD·설정을 담는다', () => {
    const { pool, out } = extract('/a/b.php', SRC);
    assert.equal(pool.text(out.templates[0].ref), 'local_x/card');
    assert.equal(pool.text(out.amd[0].ref), 'local_x/view');
    assert.equal(pool.text(out.config[0].id), 'local_x/apikey');
  });

  it('SQL 중괄호와 $DB 첫 인자를 담고 sql_ 계열은 거른다', () => {
    const { pool, out } = extract('/a/b.php', SRC);
    const names = out.tables.map(t => pool.text(t.name)).sort();
    assert.deepEqual(names, ['local_other', 'local_table']);
  });

  it('같은 값은 하나의 id를 공유한다', () => {
    const { pool, out } = extract('/a/b.php', `<?php
echo get_string('k', 'local_x');
echo get_string('k', 'local_x');
`);
    assert.equal(out.strings[0].key, out.strings[1].key);
    assert.equal(out.strings[0].component, out.strings[1].component);
  });
});

describe('extractUsages — string_for_js·strings_for_js', () => {
  const SRC = `<?php
$PAGE->requires->string_for_js('loginas', 'core');
$PAGE->requires->strings_for_js([
    'reason_menuname_member',
    "other",
], 'local_manager');
$PAGE->requires->strings_for_js(array('a', 'b'), 'moodle');
$PAGE->requires->strings_for_js($keys, 'local_manager');
`;

  it('메서드 호출과 배열 원소마다 담는다', () => {
    const { pool, out } = extract('/a/b.php', SRC);
    assert.deepEqual(out.strings.map(e => `${pool.text(e.component)}/${pool.text(e.key)}`),
      ['core/loginas', 'local_manager/reason_menuname_member', 'local_manager/other', 'core/a', 'core/b']);
  });

  it('배열 원소의 위치는 그 키 리터럴의 내용 시작', () => {
    const { out } = extract('/a/b.php', SRC);
    const lines = SRC.split('\n');
    const e = out.strings[2];
    assert.equal(e.line, 4);
    assert.equal(e.column, lines[4].indexOf('other'));
  });
});

describe('extractUsages — 확장자별', () => {
  it('mustache의 partial과 {{#str}}를 담는다', () => {
    const { pool, out } = extract('/a/t.mustache', `{{> local_x/inner}}\n{{#str}}greet, local_x{{/str}}\n`);
    assert.equal(pool.text(out.templates[0].ref), 'local_x/inner');
    assert.equal(pool.text(out.strings[0].key), 'greet');
  });

  it('mustache의 컴포넌트 생략 {{#str}}는 core', () => {
    const { pool, out } = extract('/a/t.mustache', `{{#str}}department{{/str}}\n`);
    assert.equal(pool.text(out.strings[0].component), 'core');
    assert.equal(pool.text(out.strings[0].key), 'department');
  });

  it('JS의 get_string과 Templates.render를 담는다', () => {
    const { pool, out } = extract('/a/m.js', `get_string('greet', 'local_x');\nTemplates.render('local_x/card', {});\n`);
    assert.equal(pool.text(out.strings[0].key), 'greet');
    assert.equal(pool.text(out.templates[0].ref), 'local_x/card');
  });
});
