import * as vscode from 'vscode';
import { phpWordPattern } from './php-word-pattern';

const SETTING = 'php.selectDollarInWord';

/** 설정에 따라 PHP 단어 판정을 덮어쓰고, 끄면 되돌린다(Disposable을 버리면 기본으로 복귀).
 *  다른 PHP 확장이 나중에 같은 설정을 등록하면 그쪽이 이길 수 있다 — 그건 이 확장이 통제할 수 없다. */
export function registerPhpWordPattern(ctx: vscode.ExtensionContext): void {
  let applied: vscode.Disposable | undefined;
  const sync = () => {
    const want = vscode.workspace.getConfiguration('csmscode').get<boolean>(SETTING, true);
    if (want && !applied) {
      applied = vscode.languages.setLanguageConfiguration('php', { wordPattern: phpWordPattern() });
      ctx.subscriptions.push(applied);
    } else if (!want && applied) {
      applied.dispose();
      applied = undefined;
    }
  };
  sync();
  ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration(`csmscode.${SETTING}`)) sync();
  }));
}
