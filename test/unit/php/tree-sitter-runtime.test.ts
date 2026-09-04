import { strict as assert } from 'assert';
import { PhpRuntime } from '../../../src/infrastructure/php/tree-sitter-runtime';
import { ScopeTable } from '../../../src/infrastructure/php/scope-table';

describe('PhpRuntime', () => {
  let runtime: PhpRuntime;
  before(async () => { runtime = await PhpRuntime.create(); });

  it('패턴 인덱스로 매치를 구분한다', () => {
    const query = runtime.compile('(variable_name (name) @v)\n(string (string_content) @s)');
    const doc = runtime.parse("<?php $a = 'x';")!;
    const indexes = [...doc.run(query, ScopeTable.of([], doc.endIndex))].map(m => m.patternIndex);
    assert.deepEqual([...new Set(indexes)].sort(), [0, 1]);
    doc.dispose();
  });

  it('캡처 텍스트와 위치를 준다', () => {
    const query = runtime.compile('(variable_name (name) @v)');
    const doc = runtime.parse('<?php\n$abc = 1;')!;
    const first = [...doc.run(query, ScopeTable.of([], doc.endIndex))][0];
    assert.equal(first.captures.text('v'), 'abc');
    assert.equal(first.captures.line('v'), 1);
    assert.equal(first.captures.column('v'), 1);
    doc.dispose();
  });

  it('16진 이스케이프가 있어도 정상 파싱되고 캡처를 낸다', () => {
    // 옛 문법(0.20.8 + tree-sitter-wasms)은 이 입력에서 parse() 자체가 예외를 던졌다.
    // 지금 조합에서는 그 실패가 재현되지 않는다 — 깊은 중첩·NUL 바이트·깨진 UTF-16·
    // 수 MB짜리 입력으로도 parse()가 null/예외를 내는 경우를 찾지 못했다(모두 ERROR
    // 노드를 포함한 트리로 성공한다). 그래서 이 테스트는 "실패 시 null"이 아니라
    // 지금 실제로 참인 것 — 이스케이프가 있어도 파싱되고 캡처가 나온다는 것 — 을 확인한다.
    const doc = runtime.parse('<?php $a = "\\x41";')!;
    assert.ok(doc !== null);
    const varQuery = runtime.compile('(variable_name (name) @v)');
    const texts = [...doc.run(varQuery, ScopeTable.of([], doc.endIndex))].map(m => m.captures.text('v'));
    assert.deepEqual(texts, ['a']);
    doc.dispose();
  });

  it('scopeRanges: 중첩된 함수/클로저를 각각 범위로 준다', () => {
    const doc = runtime.parse('<?php\nfunction outer() {\n  $f = function () { return 1; };\n  return $f;\n}\n')!;
    const ranges = doc.scopeRanges();
    assert.equal(ranges.length, 2);
    const outer = ranges.reduce((a, b) => (a.end - a.start >= b.end - b.start ? a : b));
    const inner = ranges.find(r => r !== outer)!;
    assert.ok(inner.start > outer.start && inner.end <= outer.end);
    doc.dispose();
  });

  it('scopeRanges: 화살표 함수 본문도 별도 범위 — 안의 팩트 스코프가 바깥 함수가 아니라 화살표 함수를 가리킨다', () => {
    const doc = runtime.parse('<?php\nfunction outer() {\n  $g = fn($x) => $x + $y;\n}\n')!;
    const ranges = doc.scopeRanges();
    assert.equal(ranges.length, 2); // outer 함수 + 화살표 함수
    const scopes = ScopeTable.of(ranges, doc.endIndex);
    const varQuery = runtime.compile('(variable_name (name) @v)');
    const yMatch = [...doc.run(varQuery, scopes)].find(m => m.captures.text('v') === 'y')!;
    assert.ok(yMatch);
    const arrowRange = ranges.reduce((a, b) => (a.end - a.start <= b.end - b.start ? a : b)); // 더 짧은 범위 = 화살표 함수
    assert.deepEqual(yMatch.captures.scope('v'), arrowRange);
    doc.dispose();
  });

  it('scopeRanges: 메서드 본문도 파일 전체가 아니라 메서드 범위를 스코프로 준다', () => {
    const doc = runtime.parse('<?php\nclass C {\n  public function m() {\n    $x = 1;\n  }\n}\n')!;
    const ranges = doc.scopeRanges();
    assert.equal(ranges.length, 1); // class_declaration 자체는 스코프가 아니다 — method_declaration만
    const scopes = ScopeTable.of(ranges, doc.endIndex);
    const varQuery = runtime.compile('(variable_name (name) @v)');
    const xMatch = [...doc.run(varQuery, scopes)].find(m => m.captures.text('v') === 'x')!;
    assert.ok(xMatch);
    assert.deepEqual(xMatch.captures.scope('v'), ranges[0]);
    assert.notDeepEqual(xMatch.captures.scope('v'), { start: 0, end: doc.endIndex });
    doc.dispose();
  });

  it('classBody: 선언된 클래스의 자식 노드를 주고, 없는 클래스는 null', () => {
    const doc = runtime.parse('<?php class C { public $a; }')!;
    const body = doc.classBody('C');
    assert.ok(body !== null);
    assert.ok(body!.children().length > 0);
    assert.equal(doc.classBody('Missing'), null);
    doc.dispose();
  });

  it('classBody: interface도 자식 노드를 준다', () => {
    const doc = runtime.parse('<?php interface I { public function m(): void; }')!;
    const body = doc.classBody('I');
    assert.ok(body !== null);
    assert.ok(body!.children().length > 0);
    doc.dispose();
  });

  it('classBody: trait도 자식 노드를 준다', () => {
    const doc = runtime.parse('<?php trait T { public $a; }')!;
    const body = doc.classBody('T');
    assert.ok(body !== null);
    assert.ok(body!.children().length > 0);
    doc.dispose();
  });
});
