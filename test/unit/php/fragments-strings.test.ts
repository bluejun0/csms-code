import { strict as assert } from 'assert';
import { DYNAMIC_COMPONENT_ARG, stringFragments } from '../../../src/infrastructure/php/fragments/strings';
import { FragmentSet } from '../../../src/infrastructure/php/fragment-set';
import { PhpRuntime } from '../../../src/infrastructure/php/tree-sitter-runtime';
import { ScopeTable } from '../../../src/infrastructure/php/scope-table';
import { DocumentFacts, emptyFacts } from '../../../src/domain/code-analysis/facts';

const CODE = `<?php
class C {
  public $comp = 'local_x';
  const NAME = 'local_y';
  function f($other) {
    echo get_string('a', 'local_x');
    echo get_string('bare');
    throw new moodle_exception('code');
    echo get_string('k1', $var);
    echo get_string('k2', $this->comp);
    echo get_string('k3', self::NAME);
    echo get_string('k4', $other->comp);
    echo get_string('k5', C::NAME);
    throw new moodle_exception('k6', 'local_z');
    echo (new \\lang_string('k7', 'mod_foo'))->out();
    $v = 'literal';
  }
}`;

async function factsOf(): Promise<DocumentFacts> {
  const runtime = await PhpRuntime.create();
  const set = FragmentSet.of(stringFragments);
  const query = runtime.compile(set.source);
  const doc = runtime.parse(CODE)!;
  const facts = emptyFacts();
  set.collect(doc.run(query, ScopeTable.of(doc.scopeRanges(), doc.endIndex)),
    { add: (kind, fact) => { (facts[kind] as unknown[]).push(fact); } });
  doc.dispose();
  return facts;
}

describe('stringFragments', () => {
  let f: DocumentFacts;
  before(async () => { f = await factsOf(); });

  it('리터럴 컴포넌트', () => {
    assert.equal(f.stringCalls.find(c => c.key === 'a')!.component, 'local_x');
  });
  it('한 인자 호출은 두 인자 호출과 겹쳐 매칭되지 않는다', () => {
    assert.equal(f.stringCalls.filter(c => c.key === 'a').length, 1);
  });
  it('컴포넌트 생략은 형태별 기본값', () => {
    assert.equal(f.stringCalls.find(c => c.key === 'bare')!.component, 'core');
    assert.equal(f.stringCalls.find(c => c.key === 'code')!.component, 'error');
  });
  it('new 형태의 리터럴 컴포넌트 — 맨이름과 qualified_name(백슬래시 접두) 모두', () => {
    assert.equal(f.stringCalls.find(c => c.key === 'k6')!.component, 'local_z');
    assert.equal(f.stringCalls.find(c => c.key === 'k7')!.component, 'mod_foo');
  });
  it('동적 컴포넌트 세 형태', () => {
    assert.deepEqual(f.dynamicStringCalls.find(c => c.key === 'k1')!.comp, { kind: 'var', name: 'var' });
    assert.deepEqual(f.dynamicStringCalls.find(c => c.key === 'k2')!.comp, { kind: 'prop', name: 'comp' });
    assert.deepEqual(f.dynamicStringCalls.find(c => c.key === 'k3')!.comp, { kind: 'const', name: 'NAME' });
  });
  it('$this가 아닌 수신자의 프로퍼티는 담지 않는다', () => {
    assert.ok(!f.dynamicStringCalls.some(c => c.key === 'k4'));
  });
  it('X::NAME은 name 노드가 둘이라 마지막(상수)을 쓴다', () => {
    assert.deepEqual(f.dynamicStringCalls.find(c => c.key === 'k5')!.comp, { kind: 'const', name: 'NAME' });
  });
  it('리터럴 출처 세 종류', () => {
    assert.ok(f.literalAssignments.some(a => a.varName === 'v' && a.value === 'literal'));
    assert.ok(f.propertyLiterals.some(p => p.property === 'comp' && p.value === 'local_x'));
    assert.ok(f.constLiterals.some(c => c.name === 'NAME' && c.value === 'local_y'));
  });
  it('DYNAMIC_COMPONENT_ARG는 인자 자리에 끼워도 컴파일된다 — 설정 조각(Task 8)이 그대로 재사용한다', async () => {
    const runtime = await PhpRuntime.create();
    assert.doesNotThrow(() => runtime.compile(`(argument ${DYNAMIC_COMPONENT_ARG})`));
  });
});
