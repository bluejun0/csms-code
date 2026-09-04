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
    // isBuilt는 파일을 하나도 못 읽어도 true다 — 실제로 뭔가 읽었다는 증거로 풀에 쌓인
    // 문자열 수를 따로 본다. 실제 코퍼스는 5만 개 안팎, 빈 디렉터리는 0이다.
    const pooled = (idx as unknown as { pool: { size: number } }).pool.size;
    assert.ok(pooled > 1000,
      `색인이 실제로 아무것도 읽지 않았다 — 풀에 문자열 ${pooled}개. CSMS_CORPUS가 가리키는 경로를 확인하라`);
    assert.ok(retainedMb < CEILING_MB,
      `보유 ${retainedMb.toFixed(1)} MB — 상한 ${CEILING_MB} MB를 넘었다. 캡처가 풀을 지나지 않는 자리가 생겼을 수 있다`);
  });
});
