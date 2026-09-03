import { DocumentFacts } from '../../domain/code-analysis/facts';
import { PhpSyntax, RawClassMember } from '../../domain/code-analysis/ports/php-syntax';
import { FactKind } from './query-fragment';

export class CachedPhpSyntax implements PhpSyntax {
  private readonly entries = new Map<string, DocumentFacts>();

  constructor(private readonly inner: PhpSyntax, private readonly capacity = 8) {}

  classMembers(text: string, className: string): RawClassMember[] {
    return this.inner.classMembers(text, className);
  }

  facts(text: string, need?: ReadonlySet<FactKind>): DocumentFacts {
    const key = `${needKey(need)} ${text}`;
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    const facts = this.inner.facts(text, need);
    this.entries.set(key, facts);
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return facts;
  }
}

function needKey(need: ReadonlySet<FactKind> | undefined): string {
  return need ? [...need].sort().join(',') : '*';
}
