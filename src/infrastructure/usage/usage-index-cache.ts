import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
/** 압축 폭탄 상한 — 정상 스냅샷은 수 MB다. */
const MAX_UNPACKED = 256 * 1024 * 1024;
import { UsageSnapshot, isSnapshotUsable } from './usage-snapshot';

/** 사용처 색인 스냅샷의 디스크 저장소. 실패는 모두 삼킨다 — 캐시 때문에 기능이 죽지 않는다.
 *  gzip level 1은 압축률보다 시간을 산다. 쓰기는 임시 파일 + rename으로 원자적이라
 *  같은 워크스페이스를 여러 창이 열어도 반쪽 파일이 보이지 않는다(마지막 쓰기가 남는다). */
export class UsageIndexCache {
  private readonly file: string;
  /** 쓰기를 직렬화한다 — 같은 창에서 스캔 직후 쓰기와 저장 디바운스 쓰기가 겹치면 임시 파일이 서로를 덮는다. */
  private writing: Promise<void> = Promise.resolve();
  private seq = 0;

  constructor(dir: string, private root: string, private extVersion: string) {
    const key = crypto.createHash('sha1').update(root).digest('hex').slice(0, 16);
    this.file = path.join(dir, `usage-${key}.json.gz`);
  }

  /** 없거나 손상·버전 불일치면 null. */
  async read(): Promise<UsageSnapshot | null> {
    try {
      const gz = await fs.promises.readFile(this.file);
      const value: unknown = JSON.parse((await gunzip(gz, { maxOutputLength: MAX_UNPACKED })).toString('utf8'));
      return isSnapshotUsable(value, this.root, this.extVersion) ? value : null;
    } catch { return null; }
  }

  write(snap: UsageSnapshot): Promise<void> {
    this.writing = this.writing.then(() => this.writeNow(snap));
    return this.writing;
  }

  private async writeNow(snap: UsageSnapshot): Promise<void> {
    const tmp = `${this.file}.${process.pid}.${++this.seq}.tmp`;
    try {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      await fs.promises.writeFile(tmp, await gzip(Buffer.from(JSON.stringify(snap), 'utf8'), { level: 1 }));
      await fs.promises.rename(tmp, this.file);
    } catch (err) {
      console.error('CSMS Code: 사용처 색인 캐시를 쓰지 못했습니다.', err);
      try { await fs.promises.unlink(tmp); } catch { /* 없으면 무시 */ }
    }
  }
}
