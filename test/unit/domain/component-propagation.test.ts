import { strict as assert } from 'assert';
import { emptyFacts, DocumentFacts, DynamicStringCall } from '../../../src/domain/code-analysis/facts';
import { resolveComponentRef, describeComponentRef } from '../../../src/domain/lang-model/services/component-propagation';

const S = { start: 0, end: 1000 };
const OTHER = { start: 2000, end: 3000 };
const call = (kind: 'var' | 'prop' | 'const', name: string, scope = S): DynamicStringCall => ({
  key: 'k', comp: { kind, name } as DynamicStringCall['comp'],
  keyLine: 0, keyColumn: 0, keyIndex: 10, index: 5, scope,
});
const facts = (over: Partial<DocumentFacts>): DocumentFacts => ({ ...emptyFacts(), ...over });

describe('resolveComponentRef', () => {
  it('변수: 같은 스코프의 리터럴 대입', () => {
    const f = facts({ literalAssignments: [{ varName: 'comp', value: 'local_x', index: 1, scope: S }] });
    assert.equal(resolveComponentRef(f, call('var', 'comp')), 'local_x');
  });

  it('변수: 다른 스코프의 대입은 쓰이지 않는다', () => {
    const f = facts({ literalAssignments: [{ varName: 'comp', value: 'local_x', index: 1, scope: OTHER }] });
    assert.equal(resolveComponentRef(f, call('var', 'comp')), null);
  });

  it('변수: 서로 다른 리터럴이 둘이면 침묵', () => {
    const f = facts({ literalAssignments: [
      { varName: 'comp', value: 'local_x', index: 1, scope: S },
      { varName: 'comp', value: 'local_y', index: 2, scope: S },
    ] });
    assert.equal(resolveComponentRef(f, call('var', 'comp')), null);
  });

  it('변수: 같은 리터럴이 여러 번이면 해석된다', () => {
    const f = facts({ literalAssignments: [
      { varName: 'comp', value: 'local_x', index: 1, scope: S },
      { varName: 'comp', value: 'local_x', index: 2, scope: S },
    ] });
    assert.equal(resolveComponentRef(f, call('var', 'comp')), 'local_x');
  });

  it('프로퍼티: 선언 기본값(파일 범위)', () => {
    const f = facts({ propertyLiterals: [{ property: 'pluginname', value: 'local_p', index: 1 }] });
    assert.equal(resolveComponentRef(f, call('prop', 'pluginname')), 'local_p');
  });

  it('상수: const 선언', () => {
    const f = facts({ constLiterals: [{ name: 'NAME', value: 'local_c', index: 1 }] });
    assert.equal(resolveComponentRef(f, call('const', 'NAME')), 'local_c');
  });

  it('정의가 없으면 침묵', () => {
    assert.equal(resolveComponentRef(facts({}), call('var', 'nope')), null);
    assert.equal(resolveComponentRef(facts({}), call('prop', 'nope')), null);
    assert.equal(resolveComponentRef(facts({}), call('const', 'NOPE')), null);
  });
});

describe('describeComponentRef', () => {
  it('사람이 읽을 형태', () => {
    assert.equal(describeComponentRef({ kind: 'var', name: 'c' }), '$c');
    assert.equal(describeComponentRef({ kind: 'prop', name: 'p' }), '$this->p');
    assert.equal(describeComponentRef({ kind: 'const', name: 'N' }), '::N');
  });
});
