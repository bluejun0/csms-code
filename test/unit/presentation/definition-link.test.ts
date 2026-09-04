import { strict as assert } from 'assert';
import { definitionLinkRanges } from '../../../src/presentation/definition-link';

const location = { uri: '/root/local/x/templates/card.mustache', line: 12, column: 4 };

describe('definitionLinkRanges', () => {
  it('출발 범위는 참조가 차지하는 구간 그대로다', () => {
    const r = definitionLinkRanges({ location, origin: { line: 3, column0: 40, length: 22 } });
    assert.deepEqual(r.origin, { startLine: 3, startColumn: 40, endLine: 3, endColumn: 62 });
  });

  it('출발 범위가 없으면 origin도 없다 — VS Code가 알아서 정하게 둔다', () => {
    assert.equal(definitionLinkRanges({ location }).origin, undefined);
  });

  it('대상은 옮겨 갈 지점을 폭 0으로 가리킨다 — 정의 이동이 늘 가리켜 온 자리다', () => {
    const r = definitionLinkRanges({ location });
    assert.deepEqual(r.target, { startLine: 12, startColumn: 4, endLine: 12, endColumn: 4 });
  });

  it('컬럼 0에서 시작하는 참조도 범위가 어긋나지 않는다', () => {
    const r = definitionLinkRanges({ location, origin: { line: 0, column0: 0, length: 5 } });
    assert.deepEqual(r.origin, { startLine: 0, startColumn: 0, endLine: 0, endColumn: 5 });
  });
});
