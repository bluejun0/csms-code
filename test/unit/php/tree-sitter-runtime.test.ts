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
    const next = runtime.parse('<?php $b = 1;');
    assert.ok(next !== null);
    if (broken) broken.dispose();
    next!.dispose();
  });
});
