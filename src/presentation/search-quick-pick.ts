import * as vscode from 'vscode';
import { SearchPluginItems, SearchHit } from '../application/search-plugin-items';
import { PluginCategory } from '../application/list-plugin-tree';

const CATEGORY_ICONS: Record<PluginCategory, string> = {
  tables: 'database', strings: 'symbol-string', api: 'plug', templates: 'file-code',
};

interface HitPick extends vscode.QuickPickItem { hit: SearchHit; }

/** 네 카테고리를 가로지르는 찾기. 걸러내기와 순위를 직접 정한다 —
 *  VSCode 기본 필터는 한국어 값으로만 걸린 항목을 떨어뜨리고, 제 점수로 순위를 다시 매긴다.
 *  모든 항목에 alwaysShow를 걸어 기본 필터를 통과시킨다(넘긴 순서가 곧 표시 순서다). */
export function registerSearch(ctx: vscode.ExtensionContext, command: string, search: SearchPluginItems): void {
  ctx.subscriptions.push(vscode.commands.registerCommand(command, () => {
    const picker = vscode.window.createQuickPick<HitPick>();
    picker.placeholder = '이름 또는 한국어 값으로 찾습니다 (테이블·문자열·API·템플릿)';

    picker.onDidChangeValue(value => {
      // 평면 목록을 처음 만들 때 실측 110ms — 그 사이 입력이 먹히지 않는 것처럼 보이지 않게 알린다
      picker.busy = true;
      picker.items = search.run(value).map(toPick);
      picker.busy = false;
    });

    picker.onDidAccept(() => {
      const chosen = picker.selectedItems[0];
      picker.hide();
      if (chosen) void openHit(chosen.hit);
    });

    // 평면 목록은 검색 동안만 들고 있는다 — 창이 닫히면 놓아준다
    picker.onDidHide(() => { search.release(); picker.dispose(); });
    picker.show();
  }));
}

function toPick(hit: SearchHit): HitPick {
  const parts = [hit.item.detail, hit.component].filter(Boolean);
  return {
    label: `$(${CATEGORY_ICONS[hit.category]}) ${hit.item.label}`,
    detail: parts.join(' · '),
    alwaysShow: true,
    hit,
  };
}

async function openHit(hit: SearchHit): Promise<void> {
  const at = new vscode.Position(hit.item.location.line, hit.item.location.column);
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(hit.item.location.uri),
    { selection: new vscode.Range(at, at) });
}
