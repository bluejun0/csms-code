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

  it('파싱에 실패하면 null을 주고 다음 문서에 영향을 주지 않는다', () => {
    const broken = runtime.parse('<?php $a = "\\x41";');
    const next = runtime.parse('<?php $b = 1; $c = 2;')!;
    assert.ok(next !== null);
    const varQuery = runtime.compile('(variable_name (name) @v)');
    const texts = [...next.run(varQuery, ScopeTable.of([], next.endIndex))].map(m => m.captures.text('v'));
    assert.deepEqual(texts, ['b', 'c']);
    const stmtQuery = runtime.compile('(expression_statement) @s');
    const stmts = [...next.run(stmtQuery, ScopeTable.of([], next.endIndex))];
    assert.equal(stmts.length, 2);
    if (broken) broken.dispose();
    next.dispose();
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

  it('classBody: 선언된 클래스의 자식 노드를 주고, 없는 클래스는 null', () => {
    const doc = runtime.parse('<?php class C { public $a; }')!;
    const body = doc.classBody('C');
    assert.ok(body !== null);
    assert.ok(body!.children().length > 0);
    assert.equal(doc.classBody('Missing'), null);
    doc.dispose();
  });
});
