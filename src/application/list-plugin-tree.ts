import { SourceLocation } from '../domain/shared/value-objects';
import { TableCatalog } from '../domain/moodle-model/ports/table-catalog';
import { StringCatalog } from '../domain/lang-model/ports/string-catalog';
import { ServiceCatalog } from '../domain/service-model/ports/service-catalog';
import { TemplateCatalog } from '../domain/template-model/ports/template-catalog';

export type PluginCategory = 'tables' | 'strings' | 'api' | 'templates';

export interface CategoryNode { category: PluginCategory; title: string; count: number; }
export interface PluginItem { label: string; detail: string; location: SourceLocation; }

const TITLES: Record<PluginCategory, string> = {
  tables: '테이블', strings: '문자열', api: 'API', templates: '템플릿',
};
const ORDER: PluginCategory[] = ['tables', 'strings', 'api', 'templates'];

/** 플러그인 탐색기의 세 단계(컴포넌트 → 카테고리 → 항목)를 조립한다.
 *  단계마다 물어본 것만 계산한다 — 컴포넌트 400개를 미리 펼치면 활성화가 멈춘다. */
export class ListPluginTree {
  constructor(
    private tables: TableCatalog,
    private strings: StringCatalog,
    private services: ServiceCatalog,
    private templates: TemplateCatalog,
  ) {}

  /** 네 색인의 합집합. 코어는 뒤로 민다 — 찾는 쪽은 거의 언제나 커스텀 플러그인이다. */
  components(): string[] {
    const all = new Set([
      ...this.tables.components(), ...this.strings.components(),
      ...this.services.components(), ...this.templates.components(),
    ]);
    const sorted = [...all].sort();
    return [...sorted.filter(c => !isCore(c)), ...sorted.filter(isCore)];
  }

  /** 넷을 항상 같은 순서로 준다. 0건도 적는다 — 빼면 없는 건지 아직 안 읽은 건지 구분되지 않는다. */
  categories(component: string): CategoryNode[] {
    return ORDER.map(category => ({
      category,
      title: TITLES[category],
      count: this.items(component, category).length,
    }));
  }

  items(component: string, category: PluginCategory): PluginItem[] {
    if (category === 'tables') return this.tableItems(component);
    if (category === 'strings') return this.stringItems(component);
    if (category === 'api') return this.apiItems(component);
    return this.templateItems(component);
  }

  private tableItems(component: string): PluginItem[] {
    return this.tables.tablesOf(component)
      .map(t => ({ label: t.name, detail: `컬럼 ${t.fields.length}`, location: t.location }))
      .sort(byLabel);
  }

  /** 부제와 이동 위치 모두 한국어를 먼저 본다 — 영어만 있는 키는 영어로 내려간다. */
  private stringItems(component: string): PluginItem[] {
    const out: PluginItem[] = [];
    for (const s of this.strings.keysOf(component)) {
      const entry = s.ko ?? s.en;
      if (entry) out.push({ label: s.key, detail: entry.value, location: entry.location });
    }
    return out.sort(byLabel);
  }

  /** 정렬하지 않는다 — services.php는 주석으로 API를 묶어 두어 선언 순서 자체가 정보다. */
  private apiItems(component: string): PluginItem[] {
    return this.services.functionsOf(component).map(f => ({
      label: f.name,
      detail: [f.type, f.description].filter(Boolean).join(' · '),
      location: f.location,
    }));
  }

  private templateItems(component: string): PluginItem[] {
    const out: PluginItem[] = [];
    for (const name of this.templates.namesOf(component)) {
      const location = this.templates.locationsOf(component, name)[0];
      if (location) out.push({ label: name, detail: '', location });
    }
    return out.sort(byLabel);
  }
}

function isCore(component: string): boolean {
  return component === 'core' || component.startsWith('core_');
}

function byLabel(a: PluginItem, b: PluginItem): number {
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}
