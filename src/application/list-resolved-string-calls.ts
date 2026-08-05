import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { RangeItem } from './dto';

/** 해석되는(색인에 존재하는) get_string 키의 범위 — 하이라이트용 */
export class ListResolvedStringCalls {
  constructor(private syntax: PhpSyntax, private strings: StringRepository) {}
  run(text: string): RangeItem[] {
    const out: RangeItem[] = [];
    for (const c of this.syntax.facts(text).stringCalls) {
      if (!this.strings.getString(c.component, c.key)) continue;
      out.push({ line: c.keyLine, column0: c.keyColumn, length: c.key.length });
    }
    return out;
  }
}
