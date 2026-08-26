import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { closestKey } from '../domain/lang-model/services/string-validator';
import { DiagnosticItem } from './dto';
import { allStringCalls } from './string-call-lookup';
import { canonicalComponent } from './canonical-component';

export class ValidateStringKeys {
  constructor(private syntax: PhpSyntax, private strings: StringRepository) {}
  run(text: string): DiagnosticItem[] {
    const out: DiagnosticItem[] = [];
    for (const c of allStringCalls(this.syntax.facts(text))) {
      if (!this.strings.hasComponent(c.component)) continue; // 미색인 컴포넌트는 침묵(오탐 방지)
      if (this.strings.getString(c.component, c.key)) continue;
      // 호출에 적힌 이름이 아니라 lang 파일의 컴포넌트를 적는다 — 어느 파일을 봐야 하는지 바로 안다(`error` → `core_error`).
      out.push({
        kind: 'string',
        line: c.keyLine, column0: c.keyColumn, length: c.key.length,
        message: `'${canonicalComponent(this.strings, c.component)}'에 '${c.key}' 문자열이 없습니다.`,
        suggestion: closestKey(this.strings.keysOf(c.component).map(s => s.key), c.key),
      });
    }
    return out;
  }
}
