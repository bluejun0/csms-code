import { ListPluginTree, PluginCategory, PluginItem } from './list-plugin-tree';

export interface SearchOptions {
  limit?: number;
  category?: PluginCategory;
}

export interface SearchHit {
  category: PluginCategory;
  component: string;
  item: PluginItem;
}

const CATEGORIES: PluginCategory[] = ['tables', 'strings', 'api', 'templates', 'config'];
const DEFAULT_LIMIT = 200;

/** 이름 접두 → 이름 포함 → 값·설명에만 포함. 이름으로 아는 것을 먼저 보여준다. */
const enum Rank { Prefix, Name, Text }

interface Entry extends SearchHit { label: string; match: string; core: boolean; }

/** 네 카테고리를 가로지르는 이름·한국어 값 검색.
 *  평면 목록은 첫 질의에 만들고 release()로 버린다 — 실측(항목 44,692건) 만드는 데 110ms,
 *  질의당 훑기 7ms다. 상주시키면 쓰지 않는 세션에도 수 MB가 남는다. */
export class SearchPluginItems {
  private flat: Entry[] | null = null;

  constructor(private tree: ListPluginTree) {}

  /** 색인이 바뀌었거나 검색이 끝났을 때 — 다음 질의가 다시 만든다. */
  release(): void { this.flat = null; }

  /** category를 주면 그 카테고리만 — 뷰 제목줄의 돋보기가 쓴다. */
  run(query: string, options: SearchOptions = {}): SearchHit[] {
    const { limit = DEFAULT_LIMIT, category } = options;
    const q = query.trim().toLowerCase();
    if (!q) return []; // 빈 질의에 4만 건을 늘어놓지 않는다
    const scored: { entry: Entry; rank: Rank }[] = [];
    for (const entry of this.entries()) {
      if (category && entry.category !== category) continue;
      const rank = rankOf(entry, q);
      if (rank !== undefined) scored.push({ entry, rank });
    }
    scored.sort(compare);
    return scored.slice(0, limit).map(s => ({
      category: s.entry.category, component: s.entry.component, item: s.entry.item,
    }));
  }

  private entries(): Entry[] {
    return this.flat ??= this.buildFlat();
  }

  private buildFlat(): Entry[] {
    const out: Entry[] = [];
    for (const category of CATEGORIES) {
      for (const { component } of this.tree.componentsIn(category)) {
        for (const item of this.tree.items(component, category)) {
          out.push({
            category, component, item,
            label: item.label.toLowerCase(),
            match: item.match.toLowerCase(),
            core: isCore(component),
          });
        }
      }
    }
    return out;
  }
}

function rankOf(entry: Entry, q: string): Rank | undefined {
  if (entry.label.startsWith(q)) return Rank.Prefix;
  if (entry.label.includes(q)) return Rank.Name;
  return entry.match.includes(q) ? Rank.Text : undefined;
}

function compare(a: { entry: Entry; rank: Rank }, b: { entry: Entry; rank: Rank }): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.entry.core !== b.entry.core) return a.entry.core ? 1 : -1;
  if (a.entry.component !== b.entry.component) return a.entry.component < b.entry.component ? -1 : 1;
  return a.entry.label < b.entry.label ? -1 : a.entry.label > b.entry.label ? 1 : 0;
}

function isCore(component: string): boolean {
  return component === 'core' || component.startsWith('core_');
}
