import { strict as assert } from 'assert';
import { StringPool } from '../../../src/infrastructure/usage/string-pool';

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
});

const gc = () => { for (let i = 0; i < 4; i++) (global as { gc?: () => void }).gc?.(); };

function poolCapturesFromBigText(pool: StringPool, i: number): void {
  const big = `${'x'.repeat(4 * 1024 * 1024)}\nget_string('key_${i}', 'local_component')\n`;
  const m = /get_string\('([\w]+)',\s*'([\w]+)'\)/.exec(big)!;
  pool.id(m[1]);
  pool.id(m[2]);
}

describe('StringPool 보유량', () => {
  it('조각을 풀에 넣어도 원본 문자열이 남지 않는다', function () {
    if (typeof (global as { gc?: () => void }).gc !== 'function') this.skip();
    const pool = new StringPool();
    gc();
    for (let i = 0; i < 5; i++) {
      poolCapturesFromBigText(pool, i);
    }
    gc();
    const before = process.memoryUsage().heapUsed;
    gc();
    const retained = process.memoryUsage().heapUsed - before;
    assert.ok(retained < 1024 * 1024,
      `원본 텍스트가 붙잡혀 있다 — 보유 ${(retained / 1024).toFixed(1)} KB (조각만 남아야 한다)`);
  });
});
