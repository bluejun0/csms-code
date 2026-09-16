import { strict as assert } from 'assert';
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

function table(name: string, component: string, columns: string[]): Table {
  const fields = columns.map(c => ({
    name: c, type: 'int', comment: '', notnull: false, default: null, location: at(`${component}.xml`),
  }));
  return new Table(name, component, fields, at(`${component}.xml`, 3));
}

function fn(name: string, component: string, extra: Partial<ServiceFunction> = {}): ServiceFunction {
  return {
    name, component, classname: 'x_external', methodname: 'run',
    description: '', type: '', location: at(`${component}/services.php`), ...extra,
  };
}

function build(parts: {
  tables?: Record<string, Table[]>;
  strings?: Record<string, LangString[]>;
  services?: Record<string, ServiceFunction[]>;
  templates?: Record<string, string[]>;
}): ListPluginTree {
  const t = parts.tables ?? {}, s = parts.strings ?? {}, a = parts.services ?? {}, m = parts.templates ?? {};
  const tables: TableCatalog = { components: () => Object.keys(t), tablesOf: c => t[c] ?? [] };
  const strings: StringCatalog = { components: () => Object.keys(s), keysOf: c => s[c] ?? [] };
  const services: ServiceCatalog = { components: () => Object.keys(a), functionsOf: c => a[c] ?? [] };
  const templates: TemplateCatalog = {
    components: () => Object.keys(m),
    namesOf: c => m[c] ?? [],
    locationsOf: (c, n) => (m[c] ?? []).includes(n) ? [at(`${c}/${n}.mustache`)] : [],
  };
  return new ListPluginTree(tables, strings, services, templates);
}

describe('ListPluginTree — 컴포넌트 목록', () => {
  it('네 색인의 컴포넌트를 합집합으로 모은다', () => {
    const tree = build({
      tables: { local_a: [] },
      strings: { local_b: [] },
      services: { local_c: [] },
      templates: { local_d: [] },
    });
    assert.deepEqual(tree.components(), ['local_a', 'local_b', 'local_c', 'local_d']);
  });

  it('같은 컴포넌트가 여러 색인에 있어도 한 번만 나온다', () => {
    const tree = build({ tables: { local_a: [] }, strings: { local_a: [] }, templates: { local_a: [] } });
    assert.deepEqual(tree.components(), ['local_a']);
  });

  it('services.php만 있는 플러그인도 목록에 나온다', () => {
    const tree = build({ services: { local_onlyapi: [fn('ping', 'local_onlyapi')] } });
    assert.deepEqual(tree.components(), ['local_onlyapi']);
  });

  it('코어는 이름순 뒤로 밀린다 — 커스텀 플러그인을 먼저 본다', () => {
    const tree = build({ strings: { core_grades: [], local_z: [], core: [], block_a: [] } });
    assert.deepEqual(tree.components(), ['block_a', 'local_z', 'core', 'core_grades']);
  });

  it('theme_·mod_는 코어가 아니다', () => {
    const tree = build({ strings: { theme_coursemos: [], core: [], mod_quiz: [] } });
    assert.deepEqual(tree.components(), ['mod_quiz', 'theme_coursemos', 'core']);
  });
});

describe('ListPluginTree — 카테고리', () => {
  const tree = build({
    tables: { local_a: [table('local_a_log', 'local_a', ['id'])] },
    templates: { local_a: ['card', 'row'] },
  });

  it('없는 카테고리도 0으로 항상 넷을 준다 — 없는 건지 안 만든 건지 구분되게', () =>
    assert.deepEqual(tree.categories('local_a').map(c => `${c.title} ${c.count}`),
      ['테이블 1', '문자열 0', 'API 0', '템플릿 2']));

  it('순서는 테이블·문자열·API·템플릿으로 고정', () =>
    assert.deepEqual(tree.categories('local_a').map(c => c.category), ['tables', 'strings', 'api', 'templates']));
});

describe('ListPluginTree — 항목', () => {
  it('테이블: 이름순, 컬럼 수를 부제로', () => {
    const tree = build({ tables: { local_a: [table('local_a_z', 'local_a', ['id']), table('local_a_b', 'local_a', ['id', 'courseid'])] } });
    assert.deepEqual(tree.items('local_a', 'tables').map(i => `${i.label}|${i.detail}`),
      ['local_a_b|컬럼 2', 'local_a_z|컬럼 1']);
  });

  it('테이블: TABLE 선언 줄로 간다', () =>
    assert.deepEqual(build({ tables: { local_a: [table('local_a_log', 'local_a', ['id'])] } }).items('local_a', 'tables')[0].location,
      at('local_a.xml', 3)));

  it('문자열: 키순, 한국어 값을 부제로', () => {
    const tree = build({ strings: { local_a: [
      { key: 'zeta', en: { value: 'Zeta', location: at('en.php', 5) } },
      { key: 'alpha', ko: { value: '알파', location: at('ko.php', 2) }, en: { value: 'Alpha', location: at('en.php', 2) } },
    ] } });
    assert.deepEqual(tree.items('local_a', 'strings').map(i => `${i.label}|${i.detail}`), ['alpha|알파', 'zeta|Zeta']);
  });

  it('문자열: 한국어가 있으면 한국어 줄로, 없으면 영어 줄로 간다', () => {
    const tree = build({ strings: { local_a: [
      { key: 'alpha', ko: { value: '알파', location: at('ko.php', 2) }, en: { value: 'Alpha', location: at('en.php', 9) } },
      { key: 'zeta', en: { value: 'Zeta', location: at('en.php', 5) } },
    ] } });
    assert.deepEqual(tree.items('local_a', 'strings').map(i => i.location), [at('ko.php', 2), at('en.php', 5)]);
  });

  it('API: 선언 순서 그대로, read/write와 설명을 부제로', () => {
    const tree = build({ services: { local_a: [
      fn('local_a_save', 'local_a', { type: 'write', description: '저장한다' }),
      fn('local_a_get', 'local_a', { type: 'read', description: '읽는다' }),
    ] } });
    assert.deepEqual(tree.items('local_a', 'api').map(i => `${i.label}|${i.detail}`),
      ['local_a_save|write · 저장한다', 'local_a_get|read · 읽는다']);
  });

  it('API: 설명이 없으면 종류만, 종류도 없으면 부제 없음', () => {
    const tree = build({ services: { local_a: [
      fn('no_desc', 'local_a', { type: 'read' }),
      fn('bare', 'local_a'),
    ] } });
    assert.deepEqual(tree.items('local_a', 'api').map(i => i.detail), ['read', '']);
  });

  it('템플릿: 이름순, 부제 없음', () => {
    const tree = build({ templates: { local_a: ['row', 'card'] } });
    assert.deepEqual(tree.items('local_a', 'templates').map(i => `${i.label}|${i.detail}`), ['card|', 'row|']);
  });

  it('템플릿: 그 .mustache 파일로 간다', () =>
    assert.deepEqual(build({ templates: { local_a: ['card'] } }).items('local_a', 'templates')[0].location,
      at('local_a/card.mustache')));

  it('비어 있는 카테고리는 빈 배열', () =>
    assert.deepEqual(build({ tables: { local_a: [] } }).items('local_a', 'api'), []));
});
