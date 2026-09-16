import { strict as assert } from 'assert';
import { SearchPluginItems } from '../../../src/application/search-plugin-items';
import { ListPluginTree } from '../../../src/application/list-plugin-tree';
import { Table } from '../../../src/domain/moodle-model/table';
import { TableCatalog } from '../../../src/domain/moodle-model/ports/table-catalog';
import { StringCatalog } from '../../../src/domain/lang-model/ports/string-catalog';
import { ServiceCatalog } from '../../../src/domain/service-model/ports/service-catalog';
import { TemplateCatalog } from '../../../src/domain/template-model/ports/template-catalog';
import { LangString } from '../../../src/domain/lang-model/lang-string';
import { ServiceFunction } from '../../../src/domain/service-model/service-function';
import { SourceLocation } from '../../../src/domain/shared/value-objects';

const at = (uri: string, line = 0): SourceLocation => ({ uri, line, column: 0 });

const table = (name: string, component: string): Table =>
  new Table(name, component, [], at(`${component}.xml`, 3));

const str = (key: string, ko?: string, en?: string): LangString => ({
  key,
  ...(ko ? { ko: { value: ko, location: at('ko.php', 1) } } : {}),
  ...(en ? { en: { value: en, location: at('en.php', 1) } } : {}),
});

const fn = (name: string, component: string, description = ''): ServiceFunction => ({
  name, component, classname: 'x', methodname: 'run', description, type: 'read',
  location: at(`${component}/services.php`),
});

function search(parts: {
  tables?: Record<string, Table[]>;
  strings?: Record<string, LangString[]>;
  services?: Record<string, ServiceFunction[]>;
  templates?: Record<string, string[]>;
}): SearchPluginItems {
  const t = parts.tables ?? {}, s = parts.strings ?? {}, a = parts.services ?? {}, m = parts.templates ?? {};
  const tables: TableCatalog = { components: () => Object.keys(t), tablesOf: c => t[c] ?? [] };
  const strings: StringCatalog = { components: () => Object.keys(s), keysOf: c => s[c] ?? [] };
  const services: ServiceCatalog = { components: () => Object.keys(a), functionsOf: c => a[c] ?? [] };
  const templates: TemplateCatalog = {
    components: () => Object.keys(m),
    namesOf: c => m[c] ?? [],
    locationsOf: (c, n) => (m[c] ?? []).includes(n) ? [at(`${c}/${n}.mustache`)] : [],
  };
  return new SearchPluginItems(new ListPluginTree(tables, strings, services, templates));
}

describe('SearchPluginItems — 무엇이 걸리나', () => {
  it('이름으로 찾는다', () => {
    const s = search({ tables: { local_a: [table('local_a_log', 'local_a')] } });
    assert.deepEqual(s.run('log').map(h => h.item.label), ['local_a_log']);
  });

  it('한국어 값으로 문자열을 찾는다', () => {
    const s = search({ strings: { local_a: [str('attendance_book', '출석부'), str('other', '공지')] } });
    assert.deepEqual(s.run('출석부').map(h => h.item.label), ['attendance_book']);
  });

  it('한국어 설명으로 API를 찾는다', () => {
    const s = search({ services: { local_a: [fn('local_a_get', 'local_a', '출석을 읽는다')] } });
    assert.deepEqual(s.run('출석').map(h => h.item.label), ['local_a_get']);
  });

  it('대소문자를 가리지 않는다', () => {
    const s = search({ tables: { local_a: [table('local_a_Log', 'local_a')] } });
    assert.deepEqual(s.run('LOG').map(h => h.item.label), ['local_a_Log']);
  });

  it('테이블 부제의 컬럼 수는 걸리지 않는다', () => {
    const s = search({ tables: { local_a: [table('local_a_log', 'local_a')] } });
    assert.deepEqual(s.run('컬럼'), []);
  });

  it('카테고리와 컴포넌트를 결과에 담는다', () => {
    const s = search({ strings: { local_a: [str('k', '출석부')] } });
    assert.deepEqual(s.run('출석부').map(h => `${h.category}/${h.component}`), ['strings/local_a']);
  });

  it('빈 질의는 아무것도 주지 않는다 — 4만 건을 늘어놓지 않는다', () => {
    const s = search({ tables: { local_a: [table('local_a_log', 'local_a')] } });
    assert.deepEqual(s.run(''), []);
    assert.deepEqual(s.run('   '), []);
  });

  it('맞는 게 없으면 빈 배열', () =>
    assert.deepEqual(search({ tables: { local_a: [table('local_a_log', 'local_a')] } }).run('없는말'), []));
});

describe('SearchPluginItems — 순위', () => {
  it('이름 접두 → 이름 포함 → 값에만 포함 순서다', () => {
    const s = search({ strings: { local_a: [
      str('other_key', '북마크 book'),
      str('my_book_x', '가운데'),
      str('book_first', '접두'),
    ] } });
    assert.deepEqual(s.run('book').map(h => h.item.label), ['book_first', 'my_book_x', 'other_key']);
  });

  it('같은 순위에서는 코어가 뒤로 간다', () => {
    const s = search({ tables: {
      core: [table('core_log', 'core')],
      local_z: [table('local_z_log', 'local_z')],
      core_grades: [table('core_grades_log', 'core_grades')],
      block_a: [table('block_a_log', 'block_a')],
    } });
    assert.deepEqual(s.run('_log').map(h => h.component), ['block_a', 'local_z', 'core', 'core_grades']);
  });

  it('같은 순위·같은 코어 여부면 이름순', () => {
    const s = search({ tables: { local_a: [table('local_a_zeta', 'local_a'), table('local_a_alpha', 'local_a')] } });
    assert.deepEqual(s.run('local_a').map(h => h.item.label), ['local_a_alpha', 'local_a_zeta']);
  });
});

describe('SearchPluginItems — 상한과 캐시', () => {
  const many = { local_a: Array.from({ length: 300 }, (_, i) => table(`local_a_t${String(i).padStart(3, '0')}`, 'local_a')) };

  it('기본 상한은 200건', () => assert.equal(search({ tables: many }).run('local_a').length, 200));

  it('상한을 넘겨 줄 수 있다', () => assert.equal(search({ tables: many }).run('local_a', 5).length, 5));

  it('상한은 순위가 높은 쪽부터 자른다', () =>
    assert.deepEqual(search({ tables: many }).run('local_a', 2).map(h => h.item.label),
      ['local_a_t000', 'local_a_t001']));

  it('release 뒤에도 같은 결과를 준다 — 평면 목록을 다시 만든다', () => {
    const s = search({ tables: { local_a: [table('local_a_log', 'local_a')] } });
    const before = s.run('log').map(h => h.item.label);
    s.release();
    assert.deepEqual(s.run('log').map(h => h.item.label), before);
  });
});
