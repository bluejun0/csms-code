import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { ConfigKeyRepository } from '../domain/moodle-model/ports/config-key-repository';
import { configPlugin } from '../domain/moodle-model/services/config-plugin';
import { RangeItem } from './dto';
import { allConfigCalls } from './config-call-lookup';

/** 선언으로 해석되는 설정 키의 범위 — 하이라이트용 */
export class ListResolvedConfigRefs {
  constructor(private syntax: PhpSyntax, private configs: ConfigKeyRepository) {}
  run(text: string): RangeItem[] {
    const out: RangeItem[] = [];
    for (const c of allConfigCalls(this.syntax.facts(text))) {
      if (!this.configs.declaration(configPlugin(c.plugin), c.key)) continue;
      out.push({ line: c.keyLine, column0: c.keyColumn, length: c.key.length });
    }
    return out;
  }
  /** 문서에 설정 호출이 하나라도 있는가 — 선언 색인을 깨울 필요가 있는지 판단한다(색인 없이 팩트만 본다). */
  hasCalls(text: string): boolean {
    const f = this.syntax.facts(text);
    return f.configCalls.length + f.dynamicConfigCalls.length > 0;
  }
}
