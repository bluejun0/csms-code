import { ReleaseInfo, isNewerVersion } from '../domain/updates/release';
import { ReleaseSource } from '../domain/updates/ports/release-source';

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateCheckState {
  lastCheckedAt?: number;
  skippedVersion?: string;
}

/** 자동 확인은 available만 보여 주고 나머지는 침묵한다. 수동 확인은 전부 답으로 쓴다. */
export type UpdateCheckResult =
  | { kind: 'throttled' }
  | { kind: 'failed' }
  | { kind: 'upToDate' }
  | { kind: 'skipped'; release: ReleaseInfo }
  | { kind: 'available'; release: ReleaseInfo };

export interface UpdateCheckOptions {
  /** 하루 제한을 적용할지. 수동 호출은 false — 눌렀으면 지금 확인해야 한다. */
  throttle: boolean;
}

export class CheckForUpdate {
  constructor(private readonly source: ReleaseSource, private readonly current: string) {}

  async run(state: UpdateCheckState, now: number, opts: UpdateCheckOptions): Promise<UpdateCheckResult> {
    if (opts.throttle && state.lastCheckedAt !== undefined && now - state.lastCheckedAt < CHECK_INTERVAL_MS) {
      return { kind: 'throttled' };
    }
    let latest: ReleaseInfo | undefined;
    try { latest = await this.source.latest(); } catch { return { kind: 'failed' }; }
    // 릴리스를 못 읽은 것은 최신이라는 근거가 아니다.
    if (!latest) return { kind: 'failed' };
    if (!isNewerVersion(latest.version, this.current)) return { kind: 'upToDate' };
    if (opts.throttle && state.skippedVersion && !isNewerVersion(latest.version, state.skippedVersion)) {
      return { kind: 'skipped', release: latest };
    }
    return { kind: 'available', release: latest };
  }
}
