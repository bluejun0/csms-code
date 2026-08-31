import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { UsageIndexCache } from '../../../src/infrastructure/usage/usage-index-cache';
import { SNAPSHOT_VERSION, UsageSnapshot } from '../../../src/infrastructure/usage/usage-snapshot';

const snap = (root: string, ext: string): UsageSnapshot =>
  ({ v: SNAPSHOT_VERSION, ext, root, files: [['a.php', 1, 2]], s: [0, 1, 'local_x', 'k', 3, 4], t: [], a: [], c: [] });

describe('UsageIndexCache', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(join(os.tmpdir(), 'csms-cache-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('쓰고 읽으면 같은 스냅샷', async () => {
    const c = new UsageIndexCache(dir, '/m/root', '1.0.0');
    await c.write(snap('/m/root', '1.0.0'));
    assert.deepEqual(await c.read(), snap('/m/root', '1.0.0'));
  });
  it('없으면 null', async () => assert.equal(await new UsageIndexCache(dir, '/m/root', '1.0.0').read(), null));
  it('확장 버전이 다르면 null — 추출 규칙이 바뀌었을 수 있다', async () => {
    await new UsageIndexCache(dir, '/m/root', '1.0.0').write(snap('/m/root', '1.0.0'));
    assert.equal(await new UsageIndexCache(dir, '/m/root', '2.0.0').read(), null);
  });
  it('다른 루트는 다른 파일을 본다', async () => {
    await new UsageIndexCache(dir, '/m/a', '1.0.0').write(snap('/m/a', '1.0.0'));
    assert.equal(await new UsageIndexCache(dir, '/m/b', '1.0.0').read(), null);
  });
  it('손상된 파일이면 null(예외를 던지지 않는다)', async () => {
    const c = new UsageIndexCache(dir, '/m/root', '1.0.0');
    await c.write(snap('/m/root', '1.0.0'));
    const file = fs.readdirSync(dir).find(f => f.endsWith('.json.gz'))!;
    fs.writeFileSync(join(dir, file), Buffer.from('not gzip'));
    assert.equal(await c.read(), null);
  });
  it('디렉터리가 없어도 쓰기가 성공한다(만들어 준다)', async () => {
    const c = new UsageIndexCache(join(dir, 'a', 'b'), '/m/root', '1.0.0');
    await c.write(snap('/m/root', '1.0.0'));
    assert.ok(await c.read());
  });
  it('같은 프로세스에서 쓰기가 겹쳐도 캐시가 깨지지 않는다', async () => {
    const c = new UsageIndexCache(dir, '/m/root', '1.0.0');
    await Promise.all([c.write(snap('/m/root', '1.0.0')), c.write(snap('/m/root', '1.0.0'))]);
    assert.ok(await c.read(), '겹친 쓰기 뒤에도 읽힌다');
    assert.equal(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')).length, 0, '임시 파일이 남지 않는다');
  });
  it('쓰기 실패는 예외를 던지지 않는다', async () => {
    fs.writeFileSync(join(dir, 'x.php'), 'x');
    const c = new UsageIndexCache(join(dir, 'x.php', 'nope'), '/m/root', '1.0.0');
    await c.write(snap('/m/root', '1.0.0'));
    assert.equal(await c.read(), null);
  });
});
