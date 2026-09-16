import * as fs from 'fs';
import { ServiceFunction } from '../../domain/service-model/service-function';
import { ServiceCatalog } from '../../domain/service-model/ports/service-catalog';
import { parseServiceDeclarations } from './services-declaration-parser';
import { listServicesFiles, listServicesFilesAsync, yieldNow, INDEX_YIELD_EVERY } from '../workspace/moodle-root-resolver';

type CompMap = Map<string, ServiceFunction[]>;

/** component → 그 플러그인이 노출한 외부 함수. 선언 순서를 그대로 보존한다 —
 *  services.php는 주석으로 API를 묶어 두는 일이 많아 알파벳순으로 흐트러뜨리면 읽기 어려워진다. */
export class ServiceIndex implements ServiceCatalog {
  private byComponent: CompMap = new Map();

  buildFromRoot(root: string): void {
    const map: CompMap = new Map();
    for (const { file, component } of listServicesFiles(root)) mergeInto(map, file, component, safeReadSync(file));
    this.byComponent = map;
  }

  /** 활성화 경로용 — 열거·읽기 모두 비동기, 200파일마다 양보. 완성 후 마지막에 교체한다. */
  async buildFromRootAsync(root: string, onProgress?: (done: number, total: number) => void): Promise<void> {
    const refs = await listServicesFilesAsync(root);
    const map: CompMap = new Map();
    let done = 0;
    for (const { file, component } of refs) {
      mergeInto(map, file, component, await safeReadAsync(file));
      done++;
      if (done % INDEX_YIELD_EVERY === 0) { onProgress?.(done, refs.length); await yieldNow(); }
    }
    onProgress?.(refs.length, refs.length);
    this.byComponent = map;
  }

  updateFile(file: string, component: string): void {
    this.removeFile(file);
    mergeInto(this.byComponent, file, component, safeReadSync(file));
  }

  removeFile(uri: string): void {
    for (const [component, fns] of this.byComponent) {
      const kept = fns.filter(f => f.location.uri !== uri);
      if (kept.length === fns.length) continue;
      if (kept.length === 0) this.byComponent.delete(component); else this.byComponent.set(component, kept);
    }
  }

  /** 색인된 함수 총수 — 상태 표시에 쓴다(컴포넌트 수가 아니다). */
  size(): number {
    let n = 0;
    for (const fns of this.byComponent.values()) n += fns.length;
    return n;
  }

  components(): string[] { return [...this.byComponent.keys()].sort(); }
  functionsOf(component: string): ServiceFunction[] { return this.byComponent.get(component) ?? []; }
}

/** 조립 단일 지점 — 동기·비동기·증분 세 경로가 모두 이 함수만 쓴다. */
function mergeInto(map: CompMap, file: string, component: string, text: string): void {
  const fns = parseServiceDeclarations(text).map(d => ({
    name: d.name,
    component,
    classname: d.classname,
    methodname: d.methodname,
    description: d.description,
    type: d.type,
    location: { uri: file, line: d.line, column: 0 },
  }));
  if (fns.length === 0) return; // 빈 선언이 빈 컴포넌트 항목을 남기지 않게
  const existing = map.get(component);
  if (existing) existing.push(...fns); else map.set(component, fns);
}

function safeReadSync(file: string): string {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}
async function safeReadAsync(file: string): Promise<string> {
  try { return await fs.promises.readFile(file, 'utf8'); } catch { return ''; }
}
