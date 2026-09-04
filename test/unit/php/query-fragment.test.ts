import { strict as assert } from 'assert';
import { topLevelPatternCount } from '../../../src/infrastructure/php/query-fragment';

describe('topLevelPatternCount', () => {
  it('패턴 하나', () => {
    assert.equal(topLevelPatternCount('(variable_name (name) @v)'), 1);
  });
  it('패턴 둘', () => {
    assert.equal(topLevelPatternCount('(string_content) @s\n(nowdoc_string) @s'), 2);
  });
  it('중첩된 대괄호 대안은 하나로 센다', () => {
    assert.equal(topLevelPatternCount('(object_creation_expression [(name) @c (qualified_name (name) @c)])'), 1);
  });
  it('문자열 안의 괄호는 세지 않는다', () => {
    assert.equal(topLevelPatternCount('(member_call_expression name: (name) @m (#eq? @m "f(x)"))'), 1);
  });
  it('세미콜론 주석의 불균형 괄호는 무시한다', () => {
    assert.equal(topLevelPatternCount('; note (unbalanced\n(a) @x\n(b) @y'), 2);
  });
  it('패턴 뒤의 세미콜론 주석은 무시한다', () => {
    assert.equal(topLevelPatternCount('(first) @f ; comment (missed)\n(second) @s'), 2);
  });
});
