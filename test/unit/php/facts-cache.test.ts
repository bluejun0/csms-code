import { strict as assert } from 'assert';
import { CachedPhpSyntax } from '../../../src/infrastructure/php/facts-cache';
import { DocumentFacts, emptyFacts } from '../../../src/domain/code-analysis/facts';
import { PhpSyntax, RawClassMember } from '../../../src/domain/code-analysis/ports/php-syntax';
import { FactKind } from '../../../src/infrastructure/php/query-fragment';

class Counting implements PhpSyntax {
  calls = 0;
  memberCalls = 0;
  classMembers(_text: string, _className: string): RawClassMember[] { this.memberCalls++; return []; }
  facts(_text: string, _need?: ReadonlySet<FactKind>): DocumentFacts { this.calls++; return emptyFacts(); }
}

describe('CachedPhpSyntax', () => {
  it('classMembers는 캐시하지 않고 그대로 넘긴다', () => {
    const inner = new Counting();
    const cached = new CachedPhpSyntax(inner);
    cached.classMembers('<?php', 'x');
    cached.classMembers('<?php', 'x');
    assert.equal(inner.memberCalls, 2);
  });

  it('같은 텍스트·같은 need는 한 번만 파싱한다', () => {
    const inner = new Counting();
    const cached = new CachedPhpSyntax(inner);
    const need = new Set<FactKind>(['stringCalls']);
    assert.equal(cached.facts('<?php $a = 1;', need), cached.facts('<?php $a = 1;', need));
    assert.equal(inner.calls, 1);
  });

  it('need가 다르면 다시 파싱한다', () => {
    const inner = new Counting();
    const cached = new CachedPhpSyntax(inner);
    cached.facts('<?php $a = 1;', new Set<FactKind>(['stringCalls']));
    cached.facts('<?php $a = 1;', new Set<FactKind>(['tableRefs']));
    cached.facts('<?php $a = 1;');
    assert.equal(inner.calls, 3);
  });

  it('히트가 LRU 순서를 갱신 — A 히트 후 C 삽입이면 B가 축출된다', () => {
    const inner = new Counting();
    const cached = new CachedPhpSyntax(inner, 2);
    cached.facts('a'); cached.facts('b'); // 캐시 [a,b]
    cached.facts('a');                     // 히트 → [b,a]
    cached.facts('c');                     // b 축출 → [a,c]
    cached.facts('a');                     // 히트 — 파싱 없어야 함
    cached.facts('b');                     // 축출됐으므로 재파싱
    assert.equal(inner.calls, 4);          // a, b, c, b
  });
});
