import * as vscode from 'vscode';
import * as path from 'path';
import { IndexStore } from './infrastructure/indexing/index-store';
import { StringIndexStore } from './infrastructure/lang/string-index-store';
import { TreeSitterPhpSyntax } from './infrastructure/tree-sitter/tree-sitter-php-syntax';
import { CachedPhpSyntax } from './infrastructure/caching/cached-php-syntax';
import { findMoodleRoot, componentOfLangFile, componentOfTemplateFile, componentOfInstallXmlFile, componentOfAmdFile, langFileMetaOf } from './infrastructure/workspace/moodle-root-resolver';
import { RecordTypeInference } from './domain/code-analysis/record-type-inference';
import { ValidateRecordColumns } from './application/validate-record-columns';
import { CompleteRecordColumns } from './application/complete-record-columns';
import { ResolveRecordDefinition } from './application/resolve-record-definition';
import { DescribeRecordSymbol } from './application/describe-record-symbol';
import { CompleteStringKeys } from './application/complete-string-keys';
import { ResolveStringDefinition } from './application/resolve-string-definition';
import { DescribeString } from './application/describe-string';
import { ValidateStringKeys } from './application/validate-string-keys';
import { KeyedDebouncer } from './presentation/keyed-debouncer';
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
import { AmdIndex } from './infrastructure/amd/amd-index';
import { ResolveAmdDefinition } from './application/resolve-amd-definition';
import { ListResolvedAmdCalls } from './application/list-resolved-amd-calls';
import { FindAmdReferences } from './application/find-amd-references';
import { AmdDefinitionProvider } from './presentation/providers/amd-definition-provider';
import { AmdReferenceProvider } from './presentation/providers/amd-reference-provider';
import { ResolveTableDefinition } from './application/resolve-table-definition';
import { ListResolvedTableRefs } from './application/list-resolved-table-refs';
import { TableDefinitionProvider } from './presentation/providers/table-definition-provider';
import { ResolveJsDefinition } from './application/resolve-js-definition';
import { DescribeJsSymbol } from './application/describe-js-symbol';
import { ListResolvedJsCalls } from './application/list-resolved-js-calls';
import { JsDefinitionProvider } from './presentation/providers/js-definition-provider';
import { JsHoverProvider } from './presentation/providers/js-hover-provider';

export async function activate(ctx: vscode.ExtensionContext) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;
  const subs = vscode.workspace.getConfiguration('csmscode').get<string[]>('detectInSubfolders', ['moodle']);
  const root = findMoodleRoot(folder.uri.fsPath, subs);
  if (!root) { console.log('CSMS Code: Moodle 루트를 찾지 못했습니다.'); return; }

  const store = new IndexStore();
  const strings = new StringIndexStore();
  const templates = new TemplateIndex();
  const amd = new AmdIndex();

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

  const resolveAmd = new ResolveAmdDefinition(syntax, amd);
  const listResolvedAmd = new ListResolvedAmdCalls(syntax, amd);
  const findAmdRefs = new FindAmdReferences(usageIndex);

  const resolveTbl = new ResolveTableDefinition(syntax, store);
  const listResolvedTbl = new ListResolvedTableRefs(syntax, store);

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
    vscode.languages.registerDefinitionProvider(php, new TableDefinitionProvider(resolveTbl)),
    vscode.languages.registerDefinitionProvider(php, new AmdDefinitionProvider(resolveAmd)),
    vscode.languages.registerReferenceProvider(
      { scheme: 'file', pattern: '**/amd/src/**/*.js' },
      new AmdReferenceProvider(findAmdRefs, {
        built: () => usageIndex.isBuilt,
        build: cb => usageBuild ?? (usageBuild = usageIndex.buildFromRoot(root, cb)),
      }, file => componentOfAmdFile(root, file))),
    vscode.languages.registerDefinitionProvider(js, new JsDefinitionProvider(resolveJs)),
    vscode.languages.registerHoverProvider(js, new JsHoverProvider(describeJs)),
  );
  const diagnostics = registerDiagnostics(ctx, validate, validateStr);
  const highlight = registerResolvedHighlight(ctx, [
    { setting: 'strings.highlightResolved', languages: ['php'], run: t => listResolved.run(t) },
    { setting: 'templates.highlightResolved', languages: ['php'], run: t => listResolvedTpl.run(t) },
    { setting: 'tables.highlightResolved', languages: ['php'], run: t => listResolvedTbl.run(t) },
    { setting: 'amd.highlightResolved', languages: ['php'], run: t => listResolvedAmd.run(t) },
    { setting: 'strings.highlightResolved', languages: ['javascript'], run: t => listResolvedJs.runStrings(t) },
    { setting: 'templates.highlightResolved', languages: ['javascript'], run: t => listResolvedJs.runTemplates(t) },
  ]);
  const refreshAll = () => { diagnostics.refreshAll(); highlight.refreshAll(); };
  // 워처 폭주(예: git checkout으로 lang 수백 개 변경) 시 이벤트마다 전체 갱신하면 낭비가 N배로 쌓인다 —
  // 마지막 한 번만 의미가 있으므로 합친다. 초기 빌드 완료 후 갱신은 단발이라 즉시 호출한다.
  const refreshDebouncer = new KeyedDebouncer(200);
  ctx.subscriptions.push(refreshDebouncer);
  const scheduleRefresh = () => refreshDebouncer.schedule('all', refreshAll);

  // 색인은 비동기로 — 활성화가 확장 호스트를 막지 않는다(실측 콜드 ~1.7초).
  // 빌드 완료 전 조회는 빈 결과(침묵 원칙)이고, 완료 후 열린 문서를 한 번 갱신한다.
  // 알림이 아니라 상태바(Window) — 워크스페이스를 열 때마다 뜨는 알림은 소음이다.
  let indexing = false;
  let pendingReindex = false;
  const buildAll = async () => {
    await store.buildFromRootAsync(root);
    await strings.buildFromRootAsync(root);
    await templates.buildFromRootAsync(root);
    await amd.buildFromRootAsync(root);
  };

  /** 전체 재빌드는 항상 이 게이트를 통과한다.
   *  빌드 중 도착한 증분은 적용해도 마지막 맵 교체에 덮이므로 pendingReindex로 미루고,
   *  빌드가 끝났을 때 미뤄진 것이 있으면 없어질 때까지 반복한다(단발이면 2차 이벤트가 유실된다).
   *  예외가 나도 finally로 게이트를 반드시 내린다 — 안 내리면 증분 동기화가 세션 내내 죽는다. */
  const gatedRebuild = () => vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'CSMS Code: 색인 중…' },
    async () => {
      indexing = true;
      try {
        do { pendingReindex = false; await buildAll(); } while (pendingReindex);
      } catch (err) {
        console.error('CSMS Code: 색인에 실패했습니다.', err);
      } finally {
        indexing = false;
      }
      refreshAll();
    });
  void gatedRebuild();

  /** 워처 공통 게이트 — 빌드 중이면 증분을 적용하지 않고 재빌드로 미룬다(적용해도 덮어써진다).
   *  apply가 실제로 색인을 바꿨을 때만 갱신한다. */
  const applyIncremental = (apply: () => boolean) => {
    if (indexing) { pendingReindex = true; return; }
    if (apply()) scheduleRefresh();
  };

  // install.xml 변경 → 그 파일만 갱신
  const watcher = vscode.workspace.createFileSystemWatcher('**/db/install.xml');
  const onXml = (uri: vscode.Uri, removed: boolean) => applyIncremental(() => {
    const component = componentOfInstallXmlFile(root, uri.fsPath);
    // 역산 실패 = 우리 색인 규칙 밖의 경로. 전체 재빌드도 같은 규칙으로 열거하므로 이 파일을 담을 수 없다 —
    // 재빌드는 이득 없이 증분을 덮어쓸 위험만 있으므로 침묵한다.
    if (!component) return false;
    if (removed) store.removeFile(uri.fsPath); else store.updateFile(uri.fsPath, component);
    return true;
  });
  ctx.subscriptions.push(watcher,
    watcher.onDidChange(u => onXml(u, false)),
    watcher.onDidCreate(u => onXml(u, false)),
    watcher.onDidDelete(u => onXml(u, true)));

  // lang 파일 변경 → 그 파일만 갱신(실측 전체 재색인 122ms → ~6ms)
  const langWatcher = vscode.workspace.createFileSystemWatcher('**/lang/*/*.php');
  const onLang = (uri: vscode.Uri, removed: boolean) => applyIncremental(() => {
    const meta = langFileMetaOf(root, uri.fsPath);
    if (!meta) return false; // 규칙 밖 — 침묵(재빌드도 담을 수 없다)
    if (removed) strings.removeFile(uri.fsPath); else strings.updateFile(uri.fsPath, meta.component, meta.locale);
    return true;
  });
  ctx.subscriptions.push(langWatcher,
    langWatcher.onDidChange(u => onLang(u, false)),
    langWatcher.onDidCreate(u => onLang(u, false)),
    langWatcher.onDidDelete(u => onLang(u, true)));

  // 템플릿 변경 → 그 파일만 갱신
  const tplWatcher = vscode.workspace.createFileSystemWatcher('**/templates/**/*.mustache');
  const onTpl = (uri: vscode.Uri, removed: boolean) => applyIncremental(() => {
    const ref = componentOfTemplateFile(root, uri.fsPath);
    if (!ref) return false; // 규칙 밖 — 침묵(재빌드도 담을 수 없다)
    if (removed) templates.removeFile(uri.fsPath); else templates.updateFile(uri.fsPath, ref.component, ref.name);
    return true;
  });
  ctx.subscriptions.push(tplWatcher,
    tplWatcher.onDidChange(u => onTpl(u, false)),
    tplWatcher.onDidCreate(u => onTpl(u, false)),
    tplWatcher.onDidDelete(u => onTpl(u, true)));

  // AMD 모듈 변경 → 그 파일만 갱신
  const amdWatcher = vscode.workspace.createFileSystemWatcher('**/amd/src/**/*.js');
  const onAmd = (uri: vscode.Uri, removed: boolean) => applyIncremental(() => {
    const ref = componentOfAmdFile(root, uri.fsPath);
    if (!ref) return false; // 규칙 밖 — 침묵(재빌드도 담을 수 없다)
    if (removed) amd.removeFile(uri.fsPath); else amd.updateFile(uri.fsPath, ref.component, ref.name);
    return true;
  });
  ctx.subscriptions.push(amdWatcher,
    amdWatcher.onDidChange(u => onAmd(u, false)),
    amdWatcher.onDidCreate(u => onAmd(u, false)),
    amdWatcher.onDidDelete(u => onAmd(u, true)));

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
