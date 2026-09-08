import { ReleaseInfo, isNewerVersion } from '../domain/updates/release';
import { ReleaseSource } from '../domain/updates/ports/release-source';

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateCheckState {
  lastCheckedAt?: number;
  skippedVersion?: string;
}

export interface UpdateCheckResult {
  /** 조회를 실제로 시도했는가 — 호출부가 마지막 확인 시각을 갱신할지 정한다. */
  checked: boolean;
  notify?: ReleaseInfo;
}

export class CheckForUpdate {
  constructor(private readonly source: ReleaseSource, private readonly current: string) {}

  async run(state: UpdateCheckState, now: number): Promise<UpdateCheckResult> {
    if (state.lastCheckedAt !== undefined && now - state.lastCheckedAt < CHECK_INTERVAL_MS) {
      return { checked: false };
    }
    // 조회 실패는 알림도 오류도 만들지 않는다 — 오프라인·사내망에서 조용해야 한다.
    let latest: ReleaseInfo | undefined;
    try { latest = await this.source.latest(); } catch { return { checked: true }; }
    if (!latest) return { checked: true };
    if (!isNewerVersion(latest.version, this.current)) return { checked: true };
    if (state.skippedVersion && !isNewerVersion(latest.version, state.skippedVersion)) return { checked: true };
    return { checked: true, notify: latest };
  }
}
