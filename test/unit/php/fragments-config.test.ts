import { strict as assert } from 'assert';
import { configFragments } from '../../../src/infrastructure/php/fragments/config';
import { FragmentSet } from '../../../src/infrastructure/php/fragment-set';
import { PhpRuntime } from '../../../src/infrastructure/php/tree-sitter-runtime';
import { ScopeTable } from '../../../src/infrastructure/php/scope-table';
import { DocumentFacts, emptyFacts } from '../../../src/domain/code-analysis/facts';

const CODE = `<?php
class C {
  function f($p, $other) {
    echo get_config('local_x', 'key1');
    set_config('key2', 1, 'local_y');
    echo get_config($p, 'key3');
    set_config('key4', 1, $this->plugin);
    str_replace('a', 'b');
    echo get_config($other->plugin, 'key5');
  }
}`;

async function factsOf(): Promise<DocumentFacts> {
  const runtime = await PhpRuntime.create();
  const set = FragmentSet.of(configFragments);
  const query = runtime.compile(set.source);
  const doc = runtime.parse(CODE)!;
  const facts = emptyFacts();
  set.collect(doc.run(query, ScopeTable.of(doc.scopeRanges(), doc.endIndex)),
    { add: (kind, fact) => { (facts[kind] as unknown[]).push(fact); } });
  doc.dispose();
  return facts;
}

describe('configFragments', () => {
  let f: DocumentFacts;
  before(async () => { f = await factsOf(); });

  it('get_config는 첫 인자가 플러그인', () => {
    const c = f.configCalls.find(x => x.key === 'key1');
    assert(c, 'key1 should be found');
    assert.equal(c.plugin, 'local_x');
    assert.equal(c.kind, 'get');
  });
  it('set_config는 셋째 인자가 플러그인', () => {
    const c = f.configCalls.find(x => x.key === 'key2');
    assert(c, 'key2 should be found');
    assert.equal(c.plugin, 'local_y');
    assert.equal(c.kind, 'set');
  });
  it('configFunctionKind 필터로 비설정 호출을 제외', () => {
    assert.equal(f.configCalls.length, 2, 'str_replace는 설정 호출이 아님');
  });
  it('동적 플러그인은 형태만 담는다', () => {
    const c3 = f.dynamicConfigCalls.find(x => x.key === 'key3');
    assert(c3, 'key3 should be found');
    assert.deepEqual(c3.comp, { kind: 'var', name: 'p' });
    const c4 = f.dynamicConfigCalls.find(x => x.key === 'key4');
    assert(c4, 'key4 should be found');
    assert.deepEqual(c4.comp, { kind: 'prop', name: 'plugin' });
  });
  it('$this가 아닌 프로퍼티는 거른다', () => {
    assert.equal(f.dynamicConfigCalls.length, 2, '$other->plugin은 버려짐');
    assert(!f.dynamicConfigCalls.find(x => x.key === 'key5'), 'key5는 없어야 함');
  });
});
