import * as fs from 'fs';
import { LangEntry, LangString } from '../../domain/lang-model/lang-string';
import { StringRepository } from '../../domain/lang-model/ports/string-repository';
import { parseLangFile } from './lang-file-parser';
import { listLangFiles, listLangFilesAsync, yieldNow, INDEX_YIELD_EVERY } from '../workspace/moodle-root-resolver';
import { normalizeComponent } from '../../domain/lang-model/services/component-normalizer';

type CompMap = Map<string, Map<string, LangString>>;

export class StringIndexStore implements StringRepository {
  private byComponent: CompMap = new Map();

  buildFromRoot(root: string): void {
    const map: CompMap = new Map();
    for (const { file, component, locale } of listLangFiles(root)) {
      mergeInto(map, file, component, locale, safeReadSync(file));
    }
    this.byComponent = map;
  }

  /** 활성화 경로용 — 열거·읽기 모두 비동기, 200파일마다 양보. 완성 후 마지막에 교체한다. */
  async buildFromRootAsync(root: string, onProgress?: (done: number, total: number) => void): Promise<void> {
    const refs = await listLangFilesAsync(root);
    const map: CompMap = new Map();
    let done = 0;
    for (const { file, component, locale } of refs) {
      mergeInto(map, file, component, locale, await safeReadAsync(file));
      done++;
      if (done % INDEX_YIELD_EVERY === 0) { onProgress?.(done, refs.length); await yieldNow(); }
    }
    onProgress?.(refs.length, refs.length);
    this.byComponent = map;
  }

  /** lang 파일 하나가 바뀌면 그 파일 항목만 교체 */
  updateFile(file: string, component: string, locale: string): void {
    this.removeFile(file);
    mergeInto(this.byComponent, file, component, locale, safeReadSync(file));
  }

  /** 해당 파일에서 온 항목 제거 — 두 locale 모두 사라진 키와 빈 컴포넌트 맵까지 정리한다
   *  (정규화가 byComponent.has()에 의존하므로 빈 맵을 남기면 bare 이름 해석이 틀어진다). */
  /** 색인된 문자열 키 총수 — 상태 표시에 쓴다(컴포넌트 수가 아니다). */
  size(): number {
    let n = 0;
    for (const keys of this.byComponent.values()) n += keys.size;
    return n;
  }

  removeFile(uri: string): void {
    for (const [comp, keys] of this.byComponent) {
      for (const [key, ls] of keys) {
        if (ls.ko?.location.uri === uri) delete ls.ko;
        if (ls.en?.location.uri === uri) delete ls.en;
        if (!ls.ko && !ls.en) keys.delete(key);
      }
      if (keys.size === 0) this.byComponent.delete(comp);
    }
  }

  getString(component: string, key: string): LangString | undefined {
    return this.byComponent.get(this.normalize(component))?.get(key);
  }
  keysOf(component: string): LangString[] {
    const c = this.byComponent.get(this.normalize(component));
    return c ? [...c.values()] : [];
  }
  hasComponent(component: string): boolean { return this.byComponent.has(this.normalize(component)); }

  private normalize(raw: string): string {
    return normalizeComponent(raw, c => this.byComponent.has(c));
  }
}

/** 조립 단일 지점 — 동기·비동기·증분 세 경로가 모두 이 함수만 쓴다(결과가 갈라질 수 없다). */
function mergeInto(map: CompMap, file: string, component: string, locale: string, text: string): void {
  let comp = map.get(component);
  if (!comp) { comp = new Map(); map.set(component, comp); }
  for (const p of parseLangFileSafe(text)) {
    let entry = comp.get(p.key);
    if (!entry) { entry = { key: p.key }; comp.set(p.key, entry); }
    const e: LangEntry = { value: p.value, location: { uri: file, line: p.line, column: 0 } };
    if (locale === 'ko') entry.ko = e; else entry.en = e;
  }
  if (comp.size === 0) map.delete(component); // 빈 파일이 빈 컴포넌트 맵을 남기지 않게
}

function parseLangFileSafe(text: string) {
  try { return parseLangFile(text); } catch { return []; }
}
function safeReadSync(file: string): string {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}
async function safeReadAsync(file: string): Promise<string> {
  try { return await fs.promises.readFile(file, 'utf8'); } catch { return ''; }
}
