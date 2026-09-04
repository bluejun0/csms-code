import { Scope } from '../../domain/code-analysis/facts';

export class ScopeTable {
  private constructor(
    private readonly ranges: readonly Scope[],
    private readonly enclosing: readonly number[],
    private readonly documentEnd: number,
  ) {}

  static of(ranges: readonly Scope[], documentEnd: number): ScopeTable {
    // start가 같으면 end가 큰(바깥) 범위를 앞에 두어야 아래 스택 구성이 성립한다 — start만으로 정렬하면
    // 안쪽이 바깥보다 먼저 와 at()이 바깥만 포함하는 위치에서 안쪽 범위를 돌려줄 수 있다.
    const sorted = [...ranges].sort((a, b) => a.start - b.start || b.end - a.end);
    const enclosing: number[] = [];
    const open: number[] = [];
    sorted.forEach((range, i) => {
      while (open.length && sorted[open[open.length - 1]].end <= range.start) open.pop();
      enclosing[i] = open.length ? open[open.length - 1] : -1;
      open.push(i);
    });
    return new ScopeTable(sorted, enclosing, documentEnd);
  }

  at(index: number): Scope {
    for (let i = this.lastStartingAtOrBefore(index); i >= 0; i = this.enclosing[i]) {
      if (this.ranges[i].end > index) return this.ranges[i];
    }
    return { start: 0, end: this.documentEnd };
  }

  private lastStartingAtOrBefore(index: number): number {
    let lo = 0;
    let hi = this.ranges.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.ranges[mid].start <= index) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found;
  }
}
