import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CheckForUpdate, UpdateCheckResult, UpdateCheckState } from '../application/check-for-update';
import { ReleaseInfo } from '../domain/updates/release';
import { GitHubReleaseSource, repoSlugOf } from '../infrastructure/updates/github-release-source';

const STATE_KEY = 'csmscode.updateCheck';
const INSTALL_COMMAND = 'workbench.extensions.installExtension';
const NOTES = '릴리스 노트', INSTALL = '지금 설치', OPEN = '릴리스 페이지 열기', SKIP = '이 버전 건너뛰기';

export function registerUpdateCheck(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(vscode.commands.registerCommand('csmscode.checkForUpdatesNow', () => manual(ctx)));
  if (!vscode.workspace.getConfiguration('csmscode').get<boolean>('checkForUpdates', true)) return;
  // 시작을 막지 않는다. 자동 확인은 available 말고는 아무 것도 표시하지 않는다.
  void automatic(ctx).catch(() => undefined);
}

async function automatic(ctx: vscode.ExtensionContext): Promise<void> {
  const outcome = await check(ctx, { throttle: true });
  if (outcome?.result.kind === 'available') await present(ctx, outcome.state, outcome.result.release);
}

async function manual(ctx: vscode.ExtensionContext): Promise<void> {
  const outcome = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'CSMS Code 업데이트 확인 중' },
    () => check(ctx, { throttle: false }));

  if (!outcome) {
    vscode.window.showWarningMessage('CSMS Code: 저장소 정보를 읽을 수 없어 업데이트를 확인하지 못했습니다.');
    return;
  }
  const { state, result, current } = outcome;
  if (result.kind === 'available') await present(ctx, state, result.release);
  else if (result.kind === 'upToDate') vscode.window.showInformationMessage(`CSMS Code ${current}이 최신 버전입니다.`);
  else vscode.window.showWarningMessage('CSMS Code: 업데이트를 확인할 수 없습니다. 네트워크를 확인해 주세요.');
}

interface Outcome { state: UpdateCheckState; result: UpdateCheckResult; current: string }

async function check(ctx: vscode.ExtensionContext, opts: { throttle: boolean }): Promise<Outcome | undefined> {
  const pkg = ctx.extension?.packageJSON as { version?: string; repository?: { url?: string } } | undefined;
  const slug = repoSlugOf(pkg?.repository?.url);
  if (!slug || !pkg?.version) return undefined;

  const state = ctx.globalState.get<UpdateCheckState>(STATE_KEY, {});
  const result = await new CheckForUpdate(new GitHubReleaseSource(slug), pkg.version).run(state, Date.now(), opts);
  if (result.kind !== 'throttled') await ctx.globalState.update(STATE_KEY, { ...state, lastCheckedAt: Date.now() });
  return { state, result, current: pkg.version };
}

async function present(ctx: vscode.ExtensionContext, state: UpdateCheckState, release: ReleaseInfo): Promise<void> {
  // 명령이 사라진 판에서는 버튼을 아예 내보내지 않는다 — 눌렀는데 실패하는 것보다 낫다.
  const installable = release.assetUrl !== undefined &&
    (await vscode.commands.getCommands(true)).includes(INSTALL_COMMAND);
  const buttons = installable ? [NOTES, INSTALL, SKIP] : [NOTES, OPEN, SKIP];

  const picked = await vscode.window.showInformationMessage(
    `CSMS Code ${release.version}이 나왔습니다.`, ...buttons);

  if (picked === NOTES) await showNotes(release);
  else if (picked === OPEN) await openPage(release);
  else if (picked === INSTALL) await install(release);
  else if (picked === SKIP) await ctx.globalState.update(STATE_KEY, { ...state, skippedVersion: release.version });
}

async function showNotes(release: ReleaseInfo): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    content: `# CSMS Code ${release.version}\n\n${release.notes}\n\n${release.pageUrl}\n`,
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: true });
  try { await vscode.commands.executeCommand('markdown.showPreview'); } catch { /* 원문 그대로 둔다 */ }
}

async function openPage(release: ReleaseInfo): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(release.pageUrl));
}

async function install(release: ReleaseInfo): Promise<void> {
  let file: string;
  try {
    file = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `CSMS Code ${release.version} 내려받는 중` },
      () => download(release.assetUrl!));
  } catch {
    await fallback(release, '내려받지 못했습니다.');
    return;
  }

  try {
    await vscode.commands.executeCommand(INSTALL_COMMAND, vscode.Uri.file(file));
  } catch {
    await fallback(release, '설치하지 못했습니다.');
    return;
  } finally {
    await fs.promises.rm(path.dirname(file), { recursive: true, force: true }).catch(() => undefined);
  }

  const reload = '다시 로드';
  const picked = await vscode.window.showInformationMessage(
    `CSMS Code ${release.version}을 설치했습니다. 창을 다시 로드하면 적용됩니다.`, reload);
  if (picked === reload) await vscode.commands.executeCommand('workbench.action.reloadWindow');
}

async function fallback(release: ReleaseInfo, what: string): Promise<void> {
  const picked = await vscode.window.showWarningMessage(
    `CSMS Code ${release.version}을 ${what} 릴리스 페이지에서 받아 "VSIX에서 설치"로 깔아 주세요.`, OPEN);
  if (picked === OPEN) await openPage(release);
}

async function download(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(String(res.status));
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'csms-code-'));
  const file = path.join(dir, 'csms-code.vsix');
  await fs.promises.writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}
