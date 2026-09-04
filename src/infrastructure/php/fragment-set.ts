import { FragmentMatch } from './tree-sitter-runtime';
import { FactKind, FactSink, QueryFragment, topLevelPatternCount } from './query-fragment';

export class FragmentSet {
  private constructor(
    readonly source: string,
    private readonly fragments: readonly QueryFragment[],
  ) {}

  // 조각당 최상위 패턴이 하나여야 매치의 패턴 인덱스가 조각 배열 인덱스와 같아진다.
  static of(fragments: readonly QueryFragment[]): FragmentSet {
    fragments.forEach((f, i) => {
      const count = topLevelPatternCount(f.pattern);
      if (count !== 1) throw new Error(`조각 ${i}의 최상위 패턴이 ${count}개다 — 정확히 1개여야 한다`);
    });
    return new FragmentSet(fragments.map(f => f.pattern).join('\n'), fragments);
  }

  collect(matches: Iterable<FragmentMatch>, into: FactSink, need?: ReadonlySet<FactKind>): void {
    for (const match of matches) {
      const fragment = this.fragments[match.patternIndex];
      // of()가 인덱스 정렬을 보장하니 범위 밖 인덱스는 다르게 컴파일된 쿼리의 매치가 섞인 경우일 뿐이라, 문서 전체 팩트를 죽이는 대신 이 확장의 침묵 관례대로 그 매치만 무시한다.
      if (!fragment) continue;
      if (need && !fragment.produces.some(kind => need.has(kind))) continue;
      fragment.collect(match.captures, into);
    }
  }
}
