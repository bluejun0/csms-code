import * as fs from 'fs';
import { EventDefinition } from '../../domain/event-model/event-definition';
import { EventCatalog } from '../../domain/event-model/ports/event-catalog';
import { INDEX_YIELD_EVERY, listEventFilesAsync, yieldNow } from '../workspace/moodle-root-resolver';
import { parseEventDeclaration } from './event-declaration-parser';

type CompMap = Map<string, EventDefinition[]>;

/** component → 그 컴포넌트가 선언한 이벤트 클래스. */
export class EventIndex implements EventCatalog {
  private byComponent: CompMap = new Map();

  /** 활성화 경로용 — 읽기를 비동기로 하고 200파일마다 양보한다. 완성 후 마지막에 교체한다. */
  async buildFromRootAsync(root: string): Promise<void> {
    const map: CompMap = new Map();
    let done = 0;
    for (const { file, component } of await listEventFilesAsync(root)) {
      mergeInto(map, file, component, await safeReadAsync(file));
      if (++done % INDEX_YIELD_EVERY === 0) await yieldNow();
    }
    this.byComponent = map;
  }

  updateFile(file: string, component: string): void {
    this.removeFile(file);
    mergeInto(this.byComponent, file, component, safeReadSync(file));
  }

  removeFile(file: string): void {
    for (const [component, events] of this.byComponent) {
      const kept = events.filter(e => e.location.uri !== file);
      if (kept.length === events.length) continue;
      if (kept.length === 0) this.byComponent.delete(component); else this.byComponent.set(component, kept);
    }
  }

  size(): number {
    let n = 0;
    for (const events of this.byComponent.values()) n += events.length;
    return n;
  }

  components(): string[] { return [...this.byComponent.keys()].sort(); }
  eventsOf(component: string): EventDefinition[] { return this.byComponent.get(component) ?? []; }
}

function mergeInto(map: CompMap, file: string, component: string, text: string): void {
  const d = parseEventDeclaration(text);
  if (!d) return;
  const event: EventDefinition = {
    name: `\\${d.namespace ? `${d.namespace}\\` : ''}${d.shortName}`,
    shortName: d.shortName,
    component,
    crud: d.crud,
    title: d.title && 'key' in d.title ? { key: d.title.key, component: d.title.component ?? component } : d.title,
    location: { uri: file, line: d.line, column: d.column },
  };
  const existing = map.get(component);
  if (existing) existing.push(event); else map.set(component, [event]);
}

function safeReadSync(file: string): string {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}
async function safeReadAsync(file: string): Promise<string> {
  try { return await fs.promises.readFile(file, 'utf8'); } catch { return ''; }
}
