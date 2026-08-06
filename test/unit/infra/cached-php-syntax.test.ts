import { strict as assert } from 'assert';
import { CachedPhpSyntax } from '../../../src/infrastructure/caching/cached-php-syntax';
import { DocumentFacts } from '../../../src/domain/code-analysis/facts';
import { PhpSyntax } from '../../../src/domain/code-analysis/ports/php-syntax';

/** 파싱 호출 횟수를 세는 가짜 — 매 호출 새 객체를 반환하므로 동일 객체 단언이 캐시 히트를 증명한다 */
class CountingFake implements PhpSyntax {
  calls = 0;
  facts(_text: string): DocumentFacts {
    this.calls++;
    return { assignments: [], foreachBindings: [], dataArgBindings: [], phpdocVars: [], propertyAccesses: [], plainAssignments: [], stringCalls: [], templateCalls: [], tableRefs: [] };
  }
}

describe('CachedPhpSyntax', () => {
  it('동일 텍스트 2회 → 파싱 1회 + 동일 객체 반환', () => {
    const fake = new CountingFake();
    const c = new CachedPhpSyntax(fake, 8);
    const a = c.facts('<?php $a = 1;');
    const b = c.facts('<?php $a = 1;');
    assert.equal(fake.calls, 1);
    assert.equal(a, b);
  });
  it('다른 텍스트 → 개별 파싱', () => {
    const fake = new CountingFake();
    const c = new CachedPhpSyntax(fake, 8);
    c.facts('a'); c.facts('b');
    assert.equal(fake.calls, 2);
  });
  it('용량 초과 시 가장 오래된 항목 축출 → 재요청은 재파싱', () => {
    const fake = new CountingFake();
    const c = new CachedPhpSyntax(fake, 2);
    c.facts('a'); c.facts('b'); c.facts('c'); // 용량 2 → a 축출
    c.facts('a');                             // 재파싱
    assert.equal(fake.calls, 4);
  });
  it('히트가 LRU 순서를 갱신 — A 히트 후 C 삽입이면 B가 축출된다', () => {
    const fake = new CountingFake();
    const c = new CachedPhpSyntax(fake, 2);
    c.facts('a'); c.facts('b'); // 캐시 [a,b]
    c.facts('a');               // 히트 → [b,a]
    c.facts('c');               // b 축출 → [a,c]
    c.facts('a');               // 히트 — 파싱 없어야 함
    c.facts('b');               // 축출됐으므로 재파싱
    assert.equal(fake.calls, 4); // a, b, c, b
  });
});
