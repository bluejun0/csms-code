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
    $PAGE->requires->string_for_js('k8', 'local_m');
    $PAGE->requires->strings_for_js([
        'k9',
        'k10',
    ], 'local_n');
    $this->page->requires->strings_for_js(array('k11'), 'core');
    $PAGE->requires->strings_for_js(['k12' => 'x'], 'local_n');
    $obj->get_string('k13', 'local_o');
    $PAGE->requires->strings_for_js(['k14', 'k15'], $pn);
    $PAGE->requires->string_for_js('k16', $this->comp);
    $PAGE->requires->strings_for_js(['k17'], self::NAME);
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
  it('string_for_js 메서드 호출', () => {
    assert.equal(f.stringCalls.find(c => c.key === 'k8')!.component, 'local_m');
  });
  it('strings_for_js는 배열 원소마다 — [] 와 array() 모두', () => {
    assert.deepEqual(f.stringCalls.filter(c => ['k9', 'k10', 'k11'].includes(c.key)).map(c => `${c.component}/${c.key}`),
      ['local_n/k9', 'local_n/k10', 'core/k11']);
  });
  it('strings_for_js 원소 키 위치가 정확하다', () => {
    const k10 = f.stringCalls.find(c => c.key === 'k10')!;
    assert.equal(CODE.slice(k10.keyIndex, k10.keyIndex + 3), 'k10');
    assert.equal(k10.keyLine, CODE.split('\n').findIndex(l => l.includes("'k10'")));
  });
  it('strings_for_js의 키 => 값 원소는 담지 않는다', () => {
    assert.ok(!f.stringCalls.some(c => c.key === 'k12' || c.key === 'x'));
  });
  it('문자열 함수와 이름이 같은 메서드는 담지 않는다', () => {
    assert.ok(!f.stringCalls.some(c => c.key === 'k13'));
  });
  it('string_for_js·strings_for_js의 동적 컴포넌트 — 원소마다', () => {
    assert.deepEqual(f.dynamicStringCalls.filter(c => ['k14', 'k15', 'k16', 'k17'].includes(c.key)).map(c => [c.key, c.comp]), [
      ['k14', { kind: 'var', name: 'pn' }],
      ['k15', { kind: 'var', name: 'pn' }],
      ['k16', { kind: 'prop', name: 'comp' }],
      ['k17', { kind: 'const', name: 'NAME' }],
    ]);
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
  it('DYNAMIC_COMPONENT_ARG는 인자 자리에 끼워도 컴파일된다 — get_config/set_config의 플러그인 인자가 그대로 재사용한다', async () => {
    const runtime = await PhpRuntime.create();
    assert.doesNotThrow(() => runtime.compile(`(argument ${DYNAMIC_COMPONENT_ARG})`));
  });
});
