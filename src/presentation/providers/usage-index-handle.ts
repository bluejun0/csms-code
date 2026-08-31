import * as vscode from 'vscode';

/** 사용처 색인의 lazy 빌드 핸들 — 컴포지션 루트가 인프라를 감싸 주입(프로바이더는 인프라를 모른다) */
export interface UsageIndexHandle {
  built(): boolean;
  build(onProgress: (done: number, total: number) => void): Promise<void>;
}

// 빌드 중에 두 번째 요청이 오면 같은 알림을 기다린다 — 진입점이 여럿(참조·버튼·링크)이라 알림이 겹치기 쉽다
const inflight = new WeakMap<UsageIndexHandle, Promise<void>>();

/** 이만큼 안에 끝나면 알림을 띄우지 않는다 — 디스크 캐시에서 불러오는 경로는 조용히 지나가야 한다. */
const QUIET_MS = 400;

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** 첫 요청에만 워크스페이스 스캔(진행률 알림) — 이후는 저장 단위 증분(extension.ts). 이미 있으면 즉시 반환.
 *  빌드를 먼저 시작하고, 금방 끝나지 않을 때만 알림을 연다. */
export function ensureUsageIndex(usage: UsageIndexHandle): Promise<void> {
  if (usage.built()) return Promise.resolve();
  const running = inflight.get(usage);
  if (running) return running;

  let last: [number, number] | undefined;
  let report: ((done: number, total: number) => void) | undefined;
  const build = usage.build((done, total) => { last = [done, total]; report?.(done, total); });

  const p = (async () => {
    const quick = await Promise.race([build.then(() => true), delay(QUIET_MS).then(() => false)]);
    if (quick) return;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'CSMS Code: 사용처 색인 중…' },
      async progress => {
        let shown = 0;
        report = (done, total) => {
          const pct = total ? Math.floor((done / total) * 100) : 100;
          progress.report({ increment: pct - shown, message: `${done}/${total} 파일` });
          shown = pct;
        };
        if (last) report(...last);
        await build;
      });
  })().finally(() => inflight.delete(usage));
  inflight.set(usage, p);
  return p;
}
