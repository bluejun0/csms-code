import { DocumentFacts } from '../../domain/code-analysis/facts';
import { PhpSyntax } from '../../domain/code-analysis/ports/php-syntax';

/** 텍스트 내용을 키로 DocumentFacts를 LRU 캐시하는 데코레이터.
 *  facts()는 순수(같은 텍스트 → 같은 팩트)이므로 내용 키가 안전하다.
 *  반환 객체는 히트 간 공유된다 — 호출자는 팩트를 변형하지 않는다(기존 관례).
 *  메모리 상한: capacity × 최대 문서 텍스트(키) + 팩트 배열 — 기본 8이면 대형 Moodle lib(~800KB) 기준 수 MB. */
export class CachedPhpSyntax implements PhpSyntax {
  private cache = new Map<string, DocumentFacts>();
  constructor(private inner: PhpSyntax, private capacity = 8) {}

  facts(text: string): DocumentFacts {
    const hit = this.cache.get(text);
    if (hit) {
      this.cache.delete(text); this.cache.set(text, hit); // Map 삽입 순서 = LRU 순서
      return hit;
    }
    const f = this.inner.facts(text);
    this.cache.set(text, f);
    if (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return f;
  }
}
