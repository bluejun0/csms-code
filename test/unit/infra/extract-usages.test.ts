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

describe('extractUsages — 확장자별', () => {
  it('mustache의 partial과 {{#str}}를 담는다', () => {
    const { pool, out } = extract('/a/t.mustache', `{{> local_x/inner}}\n{{#str}}greet, local_x{{/str}}\n`);
    assert.equal(pool.text(out.templates[0].ref), 'local_x/inner');
    assert.equal(pool.text(out.strings[0].key), 'greet');
  });

  it('JS의 get_string과 Templates.render를 담는다', () => {
    const { pool, out } = extract('/a/m.js', `get_string('greet', 'local_x');\nTemplates.render('local_x/card', {});\n`);
    assert.equal(pool.text(out.strings[0].key), 'greet');
    assert.equal(pool.text(out.templates[0].ref), 'local_x/card');
  });
});
