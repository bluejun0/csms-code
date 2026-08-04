import * as vscode from 'vscode';
import * as path from 'path';
import { IndexStore } from './infrastructure/indexing/index-store';
import { TreeSitterPhpSyntax } from './infrastructure/tree-sitter/tree-sitter-php-syntax';
import { CachedPhpSyntax } from './infrastructure/caching/cached-php-syntax';
import { findMoodleRoot } from './infrastructure/workspace/moodle-root-resolver';
import { RecordTypeInference } from './domain/code-analysis/record-type-inference';
import { ValidateRecordColumns } from './application/validate-record-columns';
import { CompleteRecordColumns } from './application/complete-record-columns';
import { ResolveRecordDefinition } from './application/resolve-record-definition';
import { DescribeRecordSymbol } from './application/describe-record-symbol';
import { registerDiagnostics } from './presentation/providers/record-diagnostics';
import { RecordColumnCompletionProvider } from './presentation/providers/record-column-completion-provider';
import { RecordDefinitionProvider } from './presentation/providers/record-definition-provider';
import { RecordHoverProvider } from './presentation/providers/record-hover-provider';
import { RecordQuickFixProvider } from './presentation/providers/record-quickfix-provider';

export async function activate(ctx: vscode.ExtensionContext) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;
  const subs = vscode.workspace.getConfiguration('csmscode').get<string[]>('detectInSubfolders', []);
  const root = findMoodleRoot(folder.uri.fsPath, subs);
  if (!root) { console.log('CSMS Code: Moodle 루트를 찾지 못했습니다.'); return; }

  const store = new IndexStore();
  store.buildFromRoot(root);

  // 번들 시 dist에 tree-sitter.wasm + tree-sitter-php.wasm 복사됨
  let syntax: CachedPhpSyntax;
  try {
    syntax = new CachedPhpSyntax(await TreeSitterPhpSyntax.create(path.join(ctx.extensionPath, 'dist')), 8);
  } catch (err) {
    console.error('CSMS Code: tree-sitter WASM 로드에 실패하여 확장을 활성화할 수 없습니다.', err);
    vscode.window.showErrorMessage('CSMS Code: tree-sitter WASM 로드에 실패했습니다. 확장 기능이 비활성화됩니다.');
    return;
  }
  const inference = new RecordTypeInference();

  const validate = new ValidateRecordColumns(syntax, store, inference);
  const complete = new CompleteRecordColumns(syntax, store, inference);
  const resolve = new ResolveRecordDefinition(syntax, store, inference);
  const describe = new DescribeRecordSymbol(syntax, store, inference);

  const php: vscode.DocumentSelector = { language: 'php', scheme: 'file' };
  ctx.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(php, new RecordColumnCompletionProvider(complete), '>'),
    vscode.languages.registerDefinitionProvider(php, new RecordDefinitionProvider(resolve)),
    vscode.languages.registerHoverProvider(php, new RecordHoverProvider(describe)),
    vscode.languages.registerCodeActionsProvider(php, new RecordQuickFixProvider(), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
  );
  registerDiagnostics(ctx, validate);

  // install.xml 변경 시 증분 재색인
  const watcher = vscode.workspace.createFileSystemWatcher('**/db/install.xml');
  const reindex = () => store.buildFromRoot(root); // 단순: 전체 재색인(파일 수가 많지 않음). 최적화는 후속.
  ctx.subscriptions.push(watcher, watcher.onDidChange(reindex), watcher.onDidCreate(reindex), watcher.onDidDelete(reindex));
}
export function deactivate() { /* noop */ }
