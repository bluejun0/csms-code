import * as vscode from 'vscode';
import { CompleteConfigKeys } from '../../application/complete-config-keys';
import { sourceLabelEnabled, withSource } from '../source-label';
import { configKeyCompletionPlugin } from '../config-call-prefix';

/** get_config('plugin', '|') — 그 플러그인이 settings.php에 선언한 키 */
export class ConfigKeyCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private uc: CompleteConfigKeys, private ready: () => Promise<void>) {}
  async provideCompletionItems(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.CompletionItem[]> {
    const plugin = configKeyCompletionPlugin(doc.lineAt(pos.line).text.slice(0, pos.character));
    if (!plugin) return [];
    await this.ready();
    const labelled = sourceLabelEnabled();
    return this.uc.run(plugin).map(i => {
      const it = new vscode.CompletionItem(i.key, vscode.CompletionItemKind.Property);
      it.detail = i.settingClass;
      return withSource(it, labelled);
    });
  }
}
