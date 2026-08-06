import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { AmdRepository } from '../domain/amd-model/ports/amd-repository';
import { parseModuleRef } from '../domain/shared/module-ref';
import { DefinitionResult } from './dto';

/** `js_call_amd('component/name', …)`의 참조 → `amd/src`의 모듈 파일. 색인에 없으면 침묵. */
export class ResolveAmdDefinition {
  constructor(private syntax: PhpSyntax, private amd: AmdRepository) {}
  run(text: string, atIndex: number): DefinitionResult[] {
    const call = this.syntax.facts(text).amdCalls
      .find(c => c.refIndex <= atIndex && atIndex <= c.refIndex + c.ref.length);
    if (!call) return [];
    const ref = parseModuleRef(call.ref);
    if (!ref) return [];
    return this.amd.locationsOf(ref.component, ref.name).map(location => ({ location }));
  }
}
