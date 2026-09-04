import { DocumentFacts } from '../../domain/code-analysis/facts';
import { PhpSyntax, RawClassMember } from '../../domain/code-analysis/ports/php-syntax';
import { FactKind } from './query-fragment';

/** 텍스트별로 need 조합의 팩트를 LRU 캐시하는 데코레이터. capacity는 "문서(텍스트)" 개수를 세고,
 *  같은 텍스트의 서로 다른 need는 그 문서의 한 슬롯을 공유한다(need별로 따로 세지 않는다).
 *  반환 객체는 캐시 히트 간 공유되므로 호출자는 팩트를 변형하지 않는다(기존 관례). */
export class CachedPhpSyntax implements PhpSyntax {
  private readonly entries = new Map<string, Map<string, DocumentFacts>>();

  constructor(private readonly inner: PhpSyntax, private readonly capacity = 8) {}

  // 색인 빌드 때 클래스당 한 번만 쓰이므로 캐시하면 큰 문자열을 이득 없이 들고 있다.
  classMembers(text: string, className: string): RawClassMember[] {
    return this.inner.classMembers(text, className);
  }

  facts(text: string, need?: ReadonlySet<FactKind>): DocumentFacts {
    // need가 다르면 결과도 다르다: 부분 팩트(한 종류만 구하는 결과)를 전체 팩트로 오인하면 조용히 팩트가 빠진다.
    // 예: stringCalls만 구한 결과의 tableRefs는 빈 배열인데, 이것을 need 없이 캐시하면 다음 호출자는
    // 그 빈 배열을 전체 테이블 참조로 받게 되고 완성·진단이 조용히 사라진다. 그래서 need별로 안쪽 맵에 따로 저장한다.
    const needKeyStr = needKey(need);
    let byNeed = this.entries.get(text);
    if (byNeed) {
      // 같은 문서에 접근했으니(안쪽이 히트든 미스든) 바깥 슬롯을 최신으로 옮긴다.
      this.entries.delete(text);
      this.entries.set(text, byNeed);
      const hit = byNeed.get(needKeyStr);
      if (hit) return hit;
    } else {
      byNeed = new Map<string, DocumentFacts>();
      this.entries.set(text, byNeed);
      // 바깥 슬롯을 새로 만들 때만 용량을 검사한다 — 문서 수 기준 축출이므로.
      if (this.entries.size > this.capacity) {
        const oldest = this.entries.keys().next().value;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
    }
    const facts = this.inner.facts(text, need);
    byNeed.set(needKeyStr, facts);
    return facts;
  }
}

function needKey(need: ReadonlySet<FactKind> | undefined): string {
  return need ? [...need].sort().join(',') : '*';
}
