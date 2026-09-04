import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PhpUsageIndex } from '../../../src/infrastructure/usage/php-usage-index';
import { forceGc } from './gc-support';

const CEILING_MB = 30;

describe('PhpUsageIndex 보유 메모리', () => {
  it('코퍼스 전체를 색인해도 상한 안에 머문다', async function () {
    const root = process.env.CSMS_CORPUS;
    if (!root || !fs.existsSync(root)) this.skip();
    if (typeof (global as { gc?: () => void }).gc !== 'function') this.skip();
    this.timeout(180000);

    forceGc();
    const before = process.memoryUsage().heapUsed;
    const idx = new PhpUsageIndex(() => true);
    await idx.buildFromRoot(root);
    forceGc();
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

// CSMS_CORPUS 게이트 테스트는 환경변수가 없으면 스킵되어 CI에서 조용히 안 돈다 — 이 블록은
// 코퍼스 없이도 매번 돌아 같은 회귀(캡처가 풀을 지나지 않고 파일 원문을 붙잡는 것)를 잡는다.
// 30MB 같은 절대 상한은 이 규모의 합성 코퍼스에는 의미가 없어(파일 몇백 개 vs 실제 수만 개)
// 보유 바이트 대 원본 바이트의 비율로 판정한다.
const SYNTHETIC_FILES = 300;
const FILLER_BYTES = 20000; // 파일당 채움 — 총량을 GC 잡음보다 훨씬 크게 만들어 비율을 안정시킨다
const RETAINED_RATIO_CEILING = 0.4; // 정상 코드 실측 ~0.10, 사본 제거 실측 ~1.09 — 그 사이

/** get_string 캡처를 파일마다 다른 13자 이상 문자열로 만든다 — V8은 이 길이 이상에서만
 *  정규식 매치 결과를 원본을 가리키는 조각으로 만들어, 풀이 사본을 안 뜨면 파일 원문 전체가
 *  같이 붙잡힌다(13자 미만은 애초에 복사되어 이 회귀가 발생하지 않는다). */
function writeSyntheticCorpus(dir: string, count: number, fillerBytes: number): number {
  const filler = 'x'.repeat(fillerBytes);
  let totalBytes = 0;
  for (let i = 0; i < count; i++) {
    const body = `<?php\n// ${filler}\necho get_string('key_${i}_the_quick_brown_fox', 'local_component_${i}_the_quick_brown_fox');\n`;
    fs.writeFileSync(path.join(dir, `f${i}.php`), body, 'utf8');
    totalBytes += Buffer.byteLength(body, 'utf8');
  }
  return totalBytes;
}

describe('PhpUsageIndex 보유 메모리 — 합성 코퍼스(CSMS_CORPUS 없이 항상 실행)', () => {
  it('보유 바이트가 원본 바이트의 일정 비율 안에 머문다', async function () {
    if (typeof (global as { gc?: () => void }).gc !== 'function') this.skip();
    this.timeout(60000);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csms-usage-mem-'));
    try {
      const totalBytes = writeSyntheticCorpus(dir, SYNTHETIC_FILES, FILLER_BYTES);

      forceGc();
      const before = process.memoryUsage().heapUsed;
      const idx = new PhpUsageIndex(() => true);
      await idx.buildFromRoot(dir);
      forceGc();
      const retainedBytes = process.memoryUsage().heapUsed - before;
      const ratio = retainedBytes / totalBytes;

      // 파일마다 파일 경로 1 + component 1 + key 1 — 색인이 실제로 픽스처를 읽었다는 증거로 쓴다.
      const pooled = (idx as unknown as { pool: { size: number } }).pool.size;
      assert.equal(pooled, SYNTHETIC_FILES * 3, '파일마다 경로·component·key가 풀에 들어가야 한다');
      assert.ok(ratio < RETAINED_RATIO_CEILING,
        `보유 ${(retainedBytes / 1024).toFixed(0)} KB / 원본 ${(totalBytes / 1024).toFixed(0)} KB ` +
        `= 비율 ${ratio.toFixed(2)} — 상한 ${RETAINED_RATIO_CEILING}을 넘었다. 캡처가 풀을 지나지 않는 자리가 생겼을 수 있다`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
