import * as vscode from 'vscode';

/** 사용처 색인의 lazy 빌드 핸들 — 컴포지션 루트가 인프라를 감싸 주입(프로바이더는 인프라를 모른다) */
export interface UsageIndexHandle {
  built(): boolean;
  build(onProgress: (done: number, total: number) => void): Promise<void>;
}

// 빌드 중에 두 번째 요청이 오면 같은 알림을 기다린다 — 진입점이 여럿(참조·버튼·링크)이라 알림이 겹치기 쉽다
const inflight = new WeakMap<UsageIndexHandle, Promise<void>>();

/** 첫 요청에만 워크스페이스 스캔(진행률 알림) — 이후는 저장 단위 증분(extension.ts). 이미 있으면 즉시 반환. */
export function ensureUsageIndex(usage: UsageIndexHandle): Promise<void> {
  if (usage.built()) return Promise.resolve();
  const running = inflight.get(usage);
  if (running) return running;
  const p = Promise.resolve(vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'CSMS Code: 사용처 색인 중…' },
    async progress => {
      let last = 0;
      await usage.build((done, total) => {
        const pct = total ? Math.floor((done / total) * 100) : 100;
        progress.report({ increment: pct - last, message: `${done}/${total} 파일` });
        last = pct;
      });
    })).finally(() => inflight.delete(usage));
  inflight.set(usage, p);
  return p;
}
