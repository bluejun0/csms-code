import { strict as assert } from 'assert';
import { StringPool } from '../../../src/infrastructure/usage/string-pool';
import { forceGc } from './gc-support';

describe('StringPool', () => {
  it('같은 값은 같은 id', () => {
    const pool = new StringPool();
    assert.equal(pool.id('local_ubion'), pool.id('local_ubion'));
    assert.equal(pool.size, 1);
  });

  it('다른 값은 다른 id', () => {
    const pool = new StringPool();
    assert.notEqual(pool.id('a'), pool.id('b'));
    assert.equal(pool.size, 2);
  });

  it('id로 원래 값을 되찾는다', () => {
    const pool = new StringPool();
    const id = pool.id('get_string');
    assert.equal(pool.text(id), 'get_string');
  });

  it('find는 없는 값에 id를 만들지 않는다', () => {
    const pool = new StringPool();
    pool.id('있는값');
    assert.equal(pool.find('없는값'), undefined);
    assert.equal(pool.size, 1);
  });

  it('find는 있는 값의 id를 준다', () => {
    const pool = new StringPool();
    const id = pool.id('있는값');
    assert.equal(pool.find('있는값'), id);
  });

  it('발급된 적 없는 id로 text를 부르면 던진다(메시지에 id 포함)', () => {
    const pool = new StringPool();
    pool.id('a');
    assert.throws(() => pool.text(42), /42/);
  });
});

const CAPTURE_PATTERN = /get_string\('([\w]+)',\s*'([\w]+)'\)/;

function poolCapturesFromBigText(pool: StringPool, i: number): void {
  // 13자 이상 길이의 다양한 캡처를 사용해야 V8가 조각(slice)을 만들고 풀의 구현이 정말 제대로 작동하는지 판별할 수 있다.
  const big = `${'x'.repeat(4 * 1024 * 1024)}\nget_string('a_rather_long_key_${i}', 'local_component_${i}')\n`;
  const m = CAPTURE_PATTERN.exec(big)!;
  pool.id(m[1]);
  pool.id(m[2]);
}

describe('StringPool 보유량', () => {
  it('조각을 풀에 넣어도 원본 문자열이 남지 않는다', function () {
    if (typeof (global as { gc?: () => void }).gc !== 'function') this.skip();
    const pool = new StringPool();
    forceGc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 5; i++) {
      poolCapturesFromBigText(pool, i);
    }
    // 정규식 엔진은 마지막으로 매치한 대상 문자열 전체를 전역 상태로 붙잡으므로, 짧은 문자열로 한 번 더 실행해 놓아주지 않으면 풀과 무관하게 픽스처 텍스트 하나가 측정값에 항상 섞인다.
    CAPTURE_PATTERN.exec("get_string('k', 'c')");
    forceGc();
    const retained = process.memoryUsage().heapUsed - before;
    assert.ok(retained < 1024 * 1024,
      `원본 텍스트가 붙잡혀 있다 — 보유 ${(retained / 1024).toFixed(1)} KB (조각만 남아야 한다)`);
  });
});
