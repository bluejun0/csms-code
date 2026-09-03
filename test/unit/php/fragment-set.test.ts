import { strict as assert } from 'assert';
import { FragmentSet } from '../../../src/infrastructure/php/fragment-set';
import { Captures, FactKind, FactSink, QueryFragment } from '../../../src/infrastructure/php/query-fragment';

const stubCaptures: Captures = {
  has: () => true, text: () => 'x', index: () => 0, line: () => 0, column: () => 0,
  scope: () => ({ start: 0, end: 1 }), lastNameIn: () => null,
};

function fragment(produces: FactKind, pattern: string): QueryFragment {
  return {
    produces: [produces],
    pattern,
    collect: (_at, into) => into.add('tableRefs', { name: produces, nameLine: 0, nameColumn: 0, nameIndex: 0 }),
  };
}

function recordingSink(): { sink: FactSink; seen: string[] } {
  const seen: string[] = [];
  return { seen, sink: { add: (_kind, fact) => seen.push((fact as { name: string }).name) } };
}

describe('FragmentSet', () => {
  it('통합 소스는 조각 패턴을 순서대로 잇는다', () => {
    const set = FragmentSet.of([fragment('tableRefs', '(a) @x'), fragment('stringCalls', '(b) @y')]);
    assert.equal(set.source, '(a) @x\n(b) @y');
  });

  it('패턴 인덱스로 조각을 되찾는다', () => {
    const set = FragmentSet.of([fragment('tableRefs', '(a) @x'), fragment('stringCalls', '(b) @y')]);
    const { sink, seen } = recordingSink();
    set.collect([{ patternIndex: 1, captures: stubCaptures }], sink);
    assert.deepEqual(seen, ['stringCalls']);
  });

  it('need에 없는 조각은 건너뛴다', () => {
    const set = FragmentSet.of([fragment('tableRefs', '(a) @x'), fragment('stringCalls', '(b) @y')]);
    const { sink, seen } = recordingSink();
    set.collect(
      [{ patternIndex: 0, captures: stubCaptures }, { patternIndex: 1, captures: stubCaptures }],
      sink, new Set<FactKind>(['stringCalls']));
    assert.deepEqual(seen, ['stringCalls']);
  });

  it('최상위 패턴이 하나가 아닌 조각은 거부한다', () => {
    assert.throws(() => FragmentSet.of([fragment('tableRefs', '(a) @x\n(b) @y')]), /최상위 패턴/);
  });
});
