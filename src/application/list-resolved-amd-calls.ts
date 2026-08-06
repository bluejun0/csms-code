import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { AmdRepository } from '../domain/amd-model/ports/amd-repository';
import { parseModuleRef } from '../domain/shared/module-ref';
import { RangeItem } from './dto';

/** 색인에 존재하는 AMD 모듈 참조의 범위 — 하이라이트용 */
export class ListResolvedAmdCalls {
  constructor(private syntax: PhpSyntax, private amd: AmdRepository) {}
  run(text: string): RangeItem[] {
    const out: RangeItem[] = [];
    for (const c of this.syntax.facts(text).amdCalls) {
      const ref = parseModuleRef(c.ref);
      if (!ref || !this.amd.has(ref.component, ref.name)) continue;
      out.push({ line: c.refLine, column0: c.refColumn, length: c.ref.length });
    }
    return out;
  }
}
