import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { UsageSnapshot, isSnapshotUsable } from './usage-snapshot';

/** 사용처 색인 스냅샷의 디스크 저장소. 실패는 모두 삼킨다 — 캐시 때문에 기능이 죽지 않는다.
 *  gzip level 1은 압축률보다 시간을 산다. 쓰기는 임시 파일 + rename으로 원자적이라
 *  같은 워크스페이스를 여러 창이 열어도 반쪽 파일이 보이지 않는다(마지막 쓰기가 남는다). */
export class UsageIndexCache {
  private readonly file: string;

  constructor(dir: string, private root: string, private extVersion: string) {
    const key = crypto.createHash('sha1').update(root).digest('hex').slice(0, 16);
    this.file = path.join(dir, `usage-${key}.json.gz`);
  }

  /** 없거나 손상·버전 불일치면 null. */
  async read(): Promise<UsageSnapshot | null> {
    try {
      const gz = await fs.promises.readFile(this.file);
      const value: unknown = JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
      return isSnapshotUsable(value, this.root, this.extVersion) ? value : null;
    } catch { return null; }
  }

  async write(snap: UsageSnapshot): Promise<void> {
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      await fs.promises.writeFile(tmp, zlib.gzipSync(Buffer.from(JSON.stringify(snap), 'utf8'), { level: 1 }));
      await fs.promises.rename(tmp, this.file);
    } catch (err) {
      console.error('CSMS Code: 사용처 색인 캐시를 쓰지 못했습니다.', err);
      try { await fs.promises.unlink(tmp); } catch { /* 없으면 무시 */ }
    }
  }
}
