import { DocumentFacts } from '../../domain/code-analysis/facts';
import { PhpSyntax, RawClassMember } from '../../domain/code-analysis/ports/php-syntax';
import { FactKind } from './query-fragment';

export class CachedPhpSyntax implements PhpSyntax {
  private readonly entries = new Map<string, DocumentFacts>();

  constructor(private readonly inner: PhpSyntax, private readonly capacity = 8) {}

  // 색인 빌드 때 클래스당 한 번만 쓰이므로 캐시하면 큰 문자열을 이득 없이 들고 있다.
  classMembers(text: string, className: string): RawClassMember[] {
    return this.inner.classMembers(text, className);
  }

  facts(text: string, need?: ReadonlySet<FactKind>): DocumentFacts {
    // need가 다르면 결과도 다르다: 부분 팩트(한 종류만 구하는 결과)를 전체 팩트로 오인하면 조용히 팩트가 빠진다.
    // 예: stringCalls만 구한 결과의 tableRefs는 빈 배열인데, 이것을 need 없이 캐시하면 다음 호출자는
    // 그 빈 배열을 전체 테이블 참조로 받게 되고 완성·진단이 조용히 사라진다.
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
