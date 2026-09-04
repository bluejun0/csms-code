import { strict as assert } from 'assert';
import { join } from 'path';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/php/php-syntax';
import { StringIndexStore } from '../../../src/infrastructure/lang/string-index-store';
import { PhpUsageIndex } from '../../../src/infrastructure/usage/php-usage-index';
import { LocateStringTarget } from '../../../src/application/locate-string-target';
import { FindStringReferences } from '../../../src/application/find-string-references';

const root = join(__dirname, '../../fixtures/mini-moodle');
const store = new StringIndexStore();
store.buildFromRoot(root);

const PHP = `<?php
class x {
  public $pluginname = 'local_ubattend';
  function f() {
    echo get_string('attendance_book', 'local_ubattend');
    print_string('attendance_book', 'local_ubattend');
    echo get_string('pluginname', 'testmod');
    echo get_string('attendance_rate', $this->pluginname);
  }
}
`;

describe('LocateStringTarget — 커서 위치의 문자열 호출을 (component, key)로', () => {
  let locate: LocateStringTarget;
  before(async () => { locate = new LocateStringTarget(await TreeSitterPhpSyntax.create(), store); });

  it('PHP get_string 키 위 → canonical component + key', () => {
    assert.deepEqual(locate.php(PHP, PHP.indexOf('attendance_book') + 2),
      { component: 'local_ubattend', key: 'attendance_book' });
  });
  it('PHP print_string 키 위도 같은 대상', () => {
    const at = PHP.indexOf("print_string('attendance_book") + "print_string('".length + 1;
    assert.deepEqual(locate.php(PHP, at), { component: 'local_ubattend', key: 'attendance_book' });
  });
  it('bare 컴포넌트는 canonical로 정규화 — 사용처 색인의 키와 일치해야 한다', () => {
    assert.deepEqual(locate.php(PHP, PHP.indexOf("'pluginname'") + 2),
      { component: 'mod_testmod', key: 'pluginname' });
  });
  it('동적 컴포넌트($this->pluginname)도 전파로 해석', () => {
    assert.deepEqual(locate.php(PHP, PHP.indexOf('attendance_rate') + 2),
      { component: 'local_ubattend', key: 'attendance_rate' });
  });
  it('키 밖(컴포넌트 인자 위) → null', () => {
    // 3행 프로퍼티 기본값이 아니라 호출의 컴포넌트 인자를 가리켜야 한다
    const at = PHP.indexOf("'local_ubattend'", PHP.indexOf('get_string(')) + 3;
    assert.equal(locate.php(PHP, at), null);
  });
  it('JS getString 키 위 → 대상', () => {
    const js = "import {getString} from 'core/str';\ngetString('attendance_book', 'local_ubattend');\n";
    assert.deepEqual(locate.js(js, js.indexOf('attendance_book') + 2),
      { component: 'local_ubattend', key: 'attendance_book' });
  });
  it('mustache {{#str}} 키 위 → 대상', () => {
    const mu = '<div>{{#str}}attendance_book, local_ubattend{{/str}}</div>';
    assert.deepEqual(locate.mustache(mu, mu.indexOf('attendance_book') + 2),
      { component: 'local_ubattend', key: 'attendance_book' });
  });
});

describe('FindStringReferences — 사용처(+선언)', () => {
  const usages = new PhpUsageIndex(c => store.hasComponent(c));
  before(async () => { await usages.buildFromRoot(root); });

  it('기본: 색인의 사용처 위치만', () => {
    const refs = new FindStringReferences(usages, store).run('local_ubattend', 'attendance_book');
    assert.equal(refs.length, 2, 'PHP 1건 + JS 1건');
    assert.ok(refs.every(r => !r.uri.includes(`${join('lang', 'ko')}`) && !r.uri.includes(`${join('lang', 'en')}`)));
  });
  it('선언 포함: lang 정의(ko·en)가 앞에 붙는다', () => {
    const refs = new FindStringReferences(usages, store).run('local_ubattend', 'attendance_book', true);
    assert.equal(refs.length, 4);
    assert.ok(refs[0].uri.endsWith(join('lang', 'ko', 'local_ubattend.php')));
    assert.ok(refs[1].uri.endsWith(join('lang', 'en', 'local_ubattend.php')));
  });
  it('선언 포함: 한 locale만 있으면 그 하나만 붙는다', () => {
    const refs = new FindStringReferences(usages, store).run('tool_testtool', 'pluginname', true);
    assert.equal(refs.filter(r => r.uri.endsWith(join('lang', 'en', 'tool_testtool.php'))).length, 1);
    assert.equal(refs.filter(r => r.uri.includes(join('lang', 'ko'))).length, 0);
  });
  it('색인에 없는 키 → 빈 목록(침묵)', () => {
    assert.deepEqual(new FindStringReferences(usages, store).run('local_ubattend', 'nope', true), []);
  });
});
