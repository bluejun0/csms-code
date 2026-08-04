import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { StringItem } from './dto';

export class CompleteStringKeys {
  constructor(private strings: StringRepository) {}
  run(component: string): StringItem[] {
    return this.strings.keysOf(component).map(s => ({ key: s.key, ko: s.ko?.value, en: s.en?.value }));
  }
}
