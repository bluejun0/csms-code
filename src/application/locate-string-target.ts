import { PhpSyntax } from '../domain/code-analysis/ports/php-syntax';
import { StringRepository } from '../domain/lang-model/ports/string-repository';
import { scanJsCalls } from '../domain/code-analysis/js-call-scanner';
import { scanMustache } from '../domain/code-analysis/mustache-scanner';
import { itemWithKeyAt } from '../domain/code-analysis/key-at';
import { findStringCallAt } from './string-call-lookup';
import { canonicalComponent } from './canonical-component';
import { StringTarget } from './dto';

/** 커서 위치의 문자열 호출을 (component, key)로 확정한다 — PHP·JS·mustache 세 표면.
 *  컴포넌트는 canonical로 정규화해 돌려준다. 호출 위가 아니면 null. */
export class LocateStringTarget {
  constructor(private syntax: PhpSyntax, private strings: StringRepository) {}

  php(text: string, atIndex: number): StringTarget | null {
    const call = findStringCallAt(this.syntax.facts(text), atIndex);
    return call ? this.target(call.component, call.key) : null;
  }

  js(text: string, atIndex: number): StringTarget | null {
    const c = itemWithKeyAt(scanJsCalls(text).stringCalls, atIndex);
    return c ? this.target(c.component, c.key) : null;
  }

  mustache(text: string, atIndex: number): StringTarget | null {
    const r = itemWithKeyAt(scanMustache(text).stringRefs, atIndex);
    return r ? this.target(r.component, r.key) : null;
  }

  private target(rawComponent: string, key: string): StringTarget {
    return { component: canonicalComponent(this.strings, rawComponent), key };
  }
}
