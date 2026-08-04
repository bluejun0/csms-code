import * as fs from 'fs';
import { LangEntry, LangString } from '../../domain/lang-model/lang-string';
import { StringRepository } from '../../domain/lang-model/ports/string-repository';
import { parseLangFile } from './lang-file-parser';
import { listLangFiles } from '../workspace/moodle-root-resolver';

export class StringIndexStore implements StringRepository {
  private byComponent = new Map<string, Map<string, LangString>>();

  buildFromRoot(root: string): void {
    const map = new Map<string, Map<string, LangString>>();
    for (const { file, component, locale } of listLangFiles(root)) {
      let comp = map.get(component);
      if (!comp) { comp = new Map(); map.set(component, comp); }
      for (const p of safeParseLang(file)) {
        let entry = comp.get(p.key);
        if (!entry) { entry = { key: p.key }; comp.set(p.key, entry); }
        const e: LangEntry = { value: p.value, location: { uri: file, line: p.line, column: 0 } };
        if (locale === 'ko') entry.ko = e; else entry.en = e;
      }
    }
    this.byComponent = map;
  }

  getString(component: string, key: string): LangString | undefined {
    return this.byComponent.get(this.normalize(component))?.get(key);
  }
  keysOf(component: string): LangString[] {
    const c = this.byComponent.get(this.normalize(component));
    return c ? [...c.values()] : [];
  }
  hasComponent(component: string): boolean { return this.byComponent.has(this.normalize(component)); }

  /** raw component → canonical 색인 키. bare 이름은 코어 서브시스템 우선, 아니면 레거시 mod 단축. */
  private normalize(raw: string): string {
    const s = raw.trim();
    if (!s || s === 'moodle' || s === 'core') return 'core';
    if (s.includes('_')) return s;
    if (this.byComponent.has(`core_${s}`)) return `core_${s}`;
    return `mod_${s}`;
  }
}

function safeParseLang(file: string) {
  try { return parseLangFile(fs.readFileSync(file, 'utf8')); } catch { return []; }
}
