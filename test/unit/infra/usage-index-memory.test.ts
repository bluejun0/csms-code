import { strict as assert } from 'assert';
import * as fs from 'fs';
import { PhpUsageIndex } from '../../../src/infrastructure/usage/php-usage-index';

const CEILING_MB = 30;
const gc = () => { for (let i = 0; i < 4; i++) (global as { gc?: () => void }).gc?.(); };

describe('PhpUsageIndex 보유 메모리', () => {
  it('코퍼스 전체를 색인해도 상한 안에 머문다', async function () {
    const root = process.env.CSMS_CORPUS;
    if (!root || !fs.existsSync(root)) this.skip();
    if (typeof (global as { gc?: () => void }).gc !== 'function') this.skip();
    this.timeout(180000);

    gc();
    const before = process.memoryUsage().heapUsed;
    const idx = new PhpUsageIndex(() => true);
    await idx.buildFromRoot(root);
    gc();
    const retainedMb = (process.memoryUsage().heapUsed - before) / 1048576;

    assert.ok(idx.isBuilt);
    assert.ok(retainedMb < CEILING_MB,
      `보유 ${retainedMb.toFixed(1)} MB — 상한 ${CEILING_MB} MB를 넘었다. 캡처가 풀을 지나지 않는 자리가 생겼을 수 있다`);
  });
});
