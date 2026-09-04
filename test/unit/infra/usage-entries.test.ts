import { strict as assert } from 'assert';
import { emptyExtract } from '../../../src/infrastructure/usage/usage-entries';

describe('emptyExtract', () => {
  it('다섯 종류가 모두 빈 배열이다', () => {
    const e = emptyExtract();
    assert.deepEqual(
      Object.entries(e).map(([k, v]) => [k, (v as unknown[]).length]),
      [['strings', 0], ['templates', 0], ['amd', 0], ['config', 0], ['tables', 0]]);
  });

  it('호출마다 새 배열을 준다', () => {
    const a = emptyExtract();
    a.strings.push({ component: 0, key: 1, file: 2, line: 0, column: 0 });
    assert.equal(emptyExtract().strings.length, 0);
  });
});
