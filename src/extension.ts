import * as vscode from 'vscode';
import * as path from 'path';
import { IndexStore } from './infrastructure/indexing/index-store';
import { StringIndexStore } from './infrastructure/lang/string-index-store';
import { TreeSitterPhpSyntax } from './infrastructure/tree-sitter/tree-sitter-php-syntax';
import { CachedPhpSyntax } from './infrastructure/caching/cached-php-syntax';
import { findMoodleRoot, componentOfLangFile, componentOfTemplateFile } from './infrastructure/workspace/moodle-root-resolver';
import { RecordTypeInference } from './domain/code-analysis/record-type-inference';
import { ValidateRecordColumns } from './application/validate-record-columns';
import { CompleteRecordColumns } from './application/complete-record-columns';
import { ResolveRecordDefinition } from './application/resolve-record-definition';
import { DescribeRecordSymbol } from './application/describe-record-symbol';
import { CompleteStringKeys } from './application/complete-string-keys';
import { ResolveStringDefinition } from './application/resolve-string-definition';
import { DescribeString } from './application/describe-string';
import { ValidateStringKeys } from './application/validate-string-keys';
import { registerDiagnostics } from './presentation/providers/record-diagnostics';
import { RecordColumnCompletionProvider } from './presentation/providers/record-column-completion-provider';
import { RecordDefinitionProvider } from './presentation/providers/record-definition-provider';
import { RecordHoverProvider } from './presentation/providers/record-hover-provider';
import { RecordQuickFixProvider } from './presentation/providers/record-quickfix-provider';
import { StringKeyCompletionProvider } from './presentation/providers/string-key-completion-provider';
import { StringDefinitionProvider } from './presentation/providers/string-definition-provider';
import { StringHoverProvider } from './presentation/providers/string-hover-provider';
import { PhpUsageIndex, isIndexableSourcePath } from './infrastructure/usage/php-usage-index';
import { FindStringReferences } from './application/find-string-references';
import { ListResolvedStringCalls } from './application/list-resolved-string-calls';
import { LangReferenceProvider } from './presentation/providers/lang-reference-provider';
import { registerResolvedHighlight } from './presentation/resolved-highlight';
import { TemplateIndex } from './infrastructure/templates/template-index';
import { ResolveTemplateDefinition } from './application/resolve-template-definition';
import { FindTemplateReferences } from './application/find-template-references';
import { ListResolvedTemplateCalls } from './application/list-resolved-template-calls';
import { TemplateDefinitionProvider } from './presentation/providers/template-definition-provider';
import { TemplateReferenceProvider } from './presentation/providers/template-reference-provider';
import { ResolveJsDefinition } from './application/resolve-js-definition';
import { DescribeJsSymbol } from './application/describe-js-symbol';
import { ListResolvedJsCalls } from './application/list-resolved-js-calls';
import { JsDefinitionProvider } from './presentation/providers/js-definition-provider';
import { JsHoverProvider } from './presentation/providers/js-hover-provider';

export async function activate(ctx: vscode.ExtensionContext) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;
  const subs = vscode.workspace.getConfiguration('csmscode').get<string[]>('detectInSubfolders', []);
  const root = findMoodleRoot(folder.uri.fsPath, subs);
  if (!root) { console.log('CSMS Code: Moodle 루트를 찾지 못했습니다.'); return; }

  const store = new IndexStore();
  store.buildFromRoot(root);

  const strings = new StringIndexStore();
  strings.buildFromRoot(root);

  const templates = new TemplateIndex();
  templates.buildFromRoot(root);

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

  const completeStr = new CompleteStringKeys(strings);
  const resolveStr = new ResolveStringDefinition(syntax, strings);
  const describeStr = new DescribeString(syntax, strings);
  const validateStr = new ValidateStringKeys(syntax, strings);

  const usageIndex = new PhpUsageIndex(c => strings.hasComponent(c));
  let usageBuild: Promise<void> | undefined;
  const findRefs = new FindStringReferences(usageIndex);
  const listResolved = new ListResolvedStringCalls(syntax, strings);

  const resolveTpl = new ResolveTemplateDefinition(syntax, templates);
  const findTplRefs = new FindTemplateReferences(usageIndex);
  const listResolvedTpl = new ListResolvedTemplateCalls(syntax, templates);

  const resolveJs = new ResolveJsDefinition(strings, templates);
  const describeJs = new DescribeJsSymbol(strings, templates);
  const listResolvedJs = new ListResolvedJsCalls(strings, templates);
  const js: vscode.DocumentSelector = { language: 'javascript', scheme: 'file' };

  const php: vscode.DocumentSelector = { language: 'php', scheme: 'file' };
  ctx.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(php, new RecordColumnCompletionProvider(complete), '>'),
    vscode.languages.registerDefinitionProvider(php, new RecordDefinitionProvider(resolve)),
    vscode.languages.registerHoverProvider(php, new RecordHoverProvider(describe)),
    vscode.languages.registerCodeActionsProvider(php, new RecordQuickFixProvider(), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    vscode.languages.registerCompletionItemProvider(php, new StringKeyCompletionProvider(completeStr), "'", '"'),
    vscode.languages.registerDefinitionProvider(php, new StringDefinitionProvider(resolveStr)),
    vscode.languages.registerHoverProvider(php, new StringHoverProvider(describeStr)),
    vscode.languages.registerReferenceProvider(
      { language: 'php', scheme: 'file', pattern: '**/lang/*/*.php' },
      new LangReferenceProvider(findRefs, {
        built: () => usageIndex.isBuilt,
        build: cb => usageBuild ?? (usageBuild = usageIndex.buildFromRoot(root, cb)),
      }, file => componentOfLangFile(root, file))),
    vscode.languages.registerDefinitionProvider(php, new TemplateDefinitionProvider(resolveTpl)),
    vscode.languages.registerReferenceProvider(
      { scheme: 'file', pattern: '**/templates/**/*.mustache' },
      new TemplateReferenceProvider(findTplRefs, {
        built: () => usageIndex.isBuilt,
        build: cb => usageBuild ?? (usageBuild = usageIndex.buildFromRoot(root, cb)),
      }, file => componentOfTemplateFile(root, file))),
    vscode.languages.registerDefinitionProvider(js, new JsDefinitionProvider(resolveJs)),
    vscode.languages.registerHoverProvider(js, new JsHoverProvider(describeJs)),
  );
  registerDiagnostics(ctx, validate, validateStr);
  registerResolvedHighlight(ctx, [
    { setting: 'strings.highlightResolved', languages: ['php'], run: t => listResolved.run(t) },
    { setting: 'templates.highlightResolved', languages: ['php'], run: t => listResolvedTpl.run(t) },
    { setting: 'strings.highlightResolved', languages: ['javascript'], run: t => listResolvedJs.runStrings(t) },
    { setting: 'templates.highlightResolved', languages: ['javascript'], run: t => listResolvedJs.runTemplates(t) },
  ]);

  // install.xml 변경 시 증분 재색인
  const watcher = vscode.workspace.createFileSystemWatcher('**/db/install.xml');
  const reindex = () => store.buildFromRoot(root); // 단순: 전체 재색인(파일 수가 많지 않음). 최적화는 후속.
  ctx.subscriptions.push(watcher, watcher.onDidChange(reindex), watcher.onDidCreate(reindex), watcher.onDidDelete(reindex));

  // lang 파일 변경 시 문자열 전체 재색인(단순화 — install.xml 워처와 동일 패턴)
  const langWatcher = vscode.workspace.createFileSystemWatcher('**/lang/*/*.php');
  const restring = () => strings.buildFromRoot(root);
  ctx.subscriptions.push(langWatcher, langWatcher.onDidChange(restring), langWatcher.onDidCreate(restring), langWatcher.onDidDelete(restring));

  // 템플릿 파일 변경 시 전체 재색인(기존 워처들과 동일 단순화)
  const tplWatcher = vscode.workspace.createFileSystemWatcher('**/templates/**/*.mustache');
  const retemplate = () => templates.buildFromRoot(root);
  ctx.subscriptions.push(tplWatcher, tplWatcher.onDidChange(retemplate), tplWatcher.onDidCreate(retemplate), tplWatcher.onDidDelete(retemplate));

  // 사용처 색인 증분: lazy 빌드 이후에만, 저장된 파일 단위로 재추출
  ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument(d => {
    if (d.uri.scheme === 'file' && usageIndex.isBuilt && isIndexableSourcePath(root, d.uri.fsPath)) {
      usageIndex.updateFileText(d.uri.fsPath, d.getText());
    }
  }));

  // 삭제된 파일의 참조는 저장 이벤트가 없어 자가치유되지 않는다 — 빈 텍스트로 증분 제거
  ctx.subscriptions.push(vscode.workspace.onDidDeleteFiles(e => {
    if (!usageIndex.isBuilt) return;
    for (const f of e.files) usageIndex.updateFileText(f.fsPath, '');
  }));
}
export function deactivate() { /* noop */ }
