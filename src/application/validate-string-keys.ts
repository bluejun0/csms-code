import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { closestKey } from '../domain/lang-model/services/string-validator';
import { DiagnosticItem } from './dto';

export class ValidateStringKeys {
  constructor(private syntax: PhpSyntax, private strings: StringRepository) {}
  run(text: string): DiagnosticItem[] {
    const out: DiagnosticItem[] = [];
    for (const c of this.syntax.facts(text).stringCalls) {
      if (!this.strings.hasComponent(c.component)) continue; // 미색인 컴포넌트는 침묵(오탐 방지)
      if (this.strings.getString(c.component, c.key)) continue;
      out.push({
        line: c.keyLine, column0: c.keyColumn, length: c.key.length,
        message: `'${c.component}'에 '${c.key}' 문자열이 없습니다.`,
        suggestion: closestKey(this.strings.keysOf(c.component).map(s => s.key), c.key),
      });
    }
    return out;
  }
}
