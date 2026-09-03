import { FragmentMatch } from './tree-sitter-runtime';
import { FactKind, FactSink, QueryFragment, topLevelPatternCount } from './query-fragment';

export class FragmentSet {
  private constructor(
    readonly source: string,
    private readonly fragments: readonly QueryFragment[],
  ) {}

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
      if (!fragment) continue;
      if (need && !fragment.produces.some(kind => need.has(kind))) continue;
      fragment.collect(match.captures, into);
    }
  }
}
