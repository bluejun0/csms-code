import { strict as assert } from 'assert';
import { CachedPhpSyntax } from '../../../src/infrastructure/php/facts-cache';
import { DocumentFacts, emptyFacts } from '../../../src/domain/code-analysis/facts';
import { PhpSyntax, RawClassMember } from '../../../src/domain/code-analysis/ports/php-syntax';
import { FactKind } from '../../../src/infrastructure/php/query-fragment';

class Counting implements PhpSyntax {
  calls = 0;
  classMembers(): RawClassMember[] { return []; }
  facts(_text: string, _need?: ReadonlySet<FactKind>): DocumentFacts { this.calls++; return emptyFacts(); }
}

describe('CachedPhpSyntax', () => {
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

  it('용량을 넘으면 가장 오래된 것을 버린다', () => {
    const inner = new Counting();
    const cached = new CachedPhpSyntax(inner, 2);
    cached.facts('a'); cached.facts('b'); cached.facts('c'); cached.facts('a');
    assert.equal(inner.calls, 4);
  });
});
