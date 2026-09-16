import { SourceLocation } from '../domain/shared/value-objects';
import { TableCatalog } from '../domain/moodle-model/ports/table-catalog';
import { StringCatalog } from '../domain/lang-model/ports/string-catalog';
import { ServiceCatalog } from '../domain/service-model/ports/service-catalog';
import { TemplateCatalog } from '../domain/template-model/ports/template-catalog';

export type PluginCategory = 'tables' | 'strings' | 'api' | 'templates';

export interface ComponentNode { component: string; count: number; }
export interface PluginItem {
  label: string;
  /** 트리에 보일 부제 */
  detail: string;
  /** 검색이 훑는 텍스트. 표시용 `detail`과 나눈다 — 테이블 부제 `컬럼 12`의 숫자가 걸리면 안 된다. */
  match: string;
  location: SourceLocation;
}

/** 카테고리 뷰 네 개(테이블·문자열·API·템플릿)의 두 단계(컴포넌트 → 항목)를 조립한다. */
export class ListPluginTree {
  constructor(
    private tables: TableCatalog,
    private strings: StringCatalog,
    private services: ServiceCatalog,
    private templates: TemplateCatalog,
  ) {}

  /** 그 카테고리에 **항목이 있는** 컴포넌트만. 뷰 하나가 카테고리 하나이므로 0건은 소음이다 —
   *  테이블 뷰에 테이블 없는 플러그인 수백 개를 늘어놓을 이유가 없다.
   *  코어는 뒤로 민다 — 찾는 쪽은 거의 언제나 커스텀 플러그인이다.
   *  개수는 항목을 실제로 만들어 센다. 실측(컴포넌트 591개) 최악 24ms(템플릿)라 따로 싼 경로를
   *  두면 표시와 개수가 어긋날 위험만 생긴다. */
  componentsIn(category: PluginCategory): ComponentNode[] {
    const sorted = [...this.allComponents()].sort();
    return [...sorted.filter(c => !isCore(c)), ...sorted.filter(isCore)]
      .map(component => ({ component, count: this.items(component, category).length }))
      .filter(c => c.count > 0);
  }

  private allComponents(): Set<string> {
    return new Set([
      ...this.tables.components(), ...this.strings.components(),
      ...this.services.components(), ...this.templates.components(),
    ]);
  }

  items(component: string, category: PluginCategory): PluginItem[] {
    if (category === 'tables') return this.tableItems(component);
    if (category === 'strings') return this.stringItems(component);
    if (category === 'api') return this.apiItems(component);
    return this.templateItems(component);
  }

  private tableItems(component: string): PluginItem[] {
    return this.tables.tablesOf(component)
      .map(t => ({ label: t.name, detail: `컬럼 ${t.fields.length}`, match: t.name, location: t.location }))
      .sort(byLabel);
  }

  /** 부제와 이동 위치 모두 한국어를 먼저 본다 — 영어만 있는 키는 영어로 내려간다. */
  private stringItems(component: string): PluginItem[] {
    const out: PluginItem[] = [];
    for (const s of this.strings.keysOf(component)) {
      const entry = s.ko ?? s.en;
      if (entry) out.push({ label: s.key, detail: entry.value, match: `${s.key} ${entry.value}`, location: entry.location });
    }
    return out.sort(byLabel);
  }

  /** 정렬하지 않는다 — services.php는 주석으로 API를 묶어 두어 선언 순서 자체가 정보다. */
  private apiItems(component: string): PluginItem[] {
    return this.services.functionsOf(component).map(f => ({
      label: f.name,
      detail: [f.type, f.description].filter(Boolean).join(' · '),
      match: `${f.name} ${f.description}`.trim(),
      location: f.location,
    }));
  }

  private templateItems(component: string): PluginItem[] {
    const out: PluginItem[] = [];
    for (const name of this.templates.namesOf(component)) {
      const location = this.templates.locationsOf(component, name)[0];
      if (location) out.push({ label: name, detail: '', match: name, location });
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
