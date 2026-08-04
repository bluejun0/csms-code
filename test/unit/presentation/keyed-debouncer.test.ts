import { strict as assert } from 'assert';
import { KeyedDebouncer } from '../../../src/presentation/keyed-debouncer';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('KeyedDebouncer', () => {
  it('지연 후 정확히 1회 실행 (대기 중에는 미실행)', async () => {
    const d = new KeyedDebouncer(15);
    let n = 0;
    d.schedule('k', () => n++);
    assert.equal(n, 0); // 아직 대기 중
    await sleep(40);
    assert.equal(n, 1);
  });
  it('연속 schedule은 타이머 리셋 — 마지막 fn만 실행', async () => {
    const d = new KeyedDebouncer(15);
    const seen: string[] = [];
    d.schedule('k', () => seen.push('first'));
    d.schedule('k', () => seen.push('second'));
    await sleep(40);
    assert.deepEqual(seen, ['second']);
  });
  it('다른 key는 서로 독립', async () => {
    const d = new KeyedDebouncer(15);
    let a = 0, b = 0;
    d.schedule('a', () => a++);
    d.schedule('b', () => b++);
    await sleep(40);
    assert.equal(a, 1); assert.equal(b, 1);
  });
  it('cancel(key)은 대기 중 실행을 막는다', async () => {
    const d = new KeyedDebouncer(15);
    let n = 0;
    d.schedule('k', () => n++);
    d.cancel('k');
    await sleep(40);
    assert.equal(n, 0);
  });
  it('dispose()는 전체 대기 취소', async () => {
    const d = new KeyedDebouncer(15);
    let n = 0;
    d.schedule('a', () => n++);
    d.schedule('b', () => n++);
    d.dispose();
    await sleep(40);
    assert.equal(n, 0);
  });
});
