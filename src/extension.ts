import * as vscode from 'vscode';
import * as path from 'path';
import { IndexStore } from './infrastructure/indexing/index-store';
import { StringIndexStore } from './infrastructure/lang/string-index-store';
import { TreeSitterPhpSyntax } from './infrastructure/tree-sitter/tree-sitter-php-syntax';
import { CachedPhpSyntax } from './infrastructure/caching/cached-php-syntax';
import { pluginTypeDirsAsync, clearPluginTypeCache } from './infrastructure/workspace/plugin-type-map';
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
import { SuggestionQuickFixProvider } from './presentation/providers/suggestion-quickfix-provider';
import { StringKeyCompletionProvider } from './presentation/providers/string-key-completion-provider';
import { StringDefinitionProvider } from './presentation/providers/string-definition-provider';
import { StringHoverProvider } from './presentation/providers/string-hover-provider';
import { PhpUsageIndex, isIndexableSourcePath } from './infrastructure/usage/php-usage-index';
import { FindStringReferences } from './application/find-string-references';
import { ListResolvedStringCalls } from './application/list-resolved-string-calls';
import { LangReferenceProvider } from './presentation/providers/lang-reference-provider';
import { UsageIndexHandle } from './presentation/providers/usage-index-handle';
import { TargetReferenceProvider } from './presentation/providers/target-reference-provider';
import { UsageCodeLensProvider } from './presentation/providers/usage-code-lens-provider';
import { registerShowReferences } from './presentation/show-references';
import { SHOW_STRING_REFERENCES_COMMAND, SHOW_CONFIG_REFERENCES_COMMAND, ReferenceCounters } from './presentation/references-link';
import { langLensTargets, settingsLensTargets } from './presentation/lens-targets';
import { LocateConfigTarget } from './application/locate-config-target';
import { ResolveConfigDefinition } from './application/resolve-config-definition';
import { DescribeConfigKey } from './application/describe-config-key';
import { FindConfigReferences } from './application/find-config-references';
import { ListResolvedConfigRefs } from './application/list-resolved-config-refs';
import { CompleteConfigKeys } from './application/complete-config-keys';
import { ConfigDefinitionProvider } from './presentation/providers/config-definition-provider';
import { ConfigHoverProvider } from './presentation/providers/config-hover-provider';
import { ConfigKeyCompletionProvider } from './presentation/providers/config-key-completion-provider';
import { LocateStringTarget } from './application/locate-string-target';
import { parseLangFile } from './infrastructure/lang/lang-file-parser';
import { registerResolvedHighlight } from './presentation/resolved-highlight';
import { registerStatusBar } from './presentation/status-bar';
import { registerPhpWordPattern } from './presentation/register-php-word-pattern';
import { TemplateIndex } from './infrastructure/templates/template-index';
import { ResolveTemplateDefinition } from './application/resolve-template-definition';
import { FindTemplateReferences } from './application/find-template-references';
import { ListResolvedTemplateCalls } from './application/list-resolved-template-calls';
import { TemplateDefinitionProvider } from './presentation/providers/template-definition-provider';
import { TemplateReferenceProvider } from './presentation/providers/template-reference-provider';
import { ResolveMustacheDefinition } from './application/resolve-mustache-definition';
import { DescribeMustacheSymbol } from './application/describe-mustache-symbol';
import { ListResolvedMustacheRefs } from './application/list-resolved-mustache-refs';
import { MustacheDefinitionProvider } from './presentation/providers/mustache-definition-provider';
import { MustacheHoverProvider } from './presentation/providers/mustache-hover-provider';
import { AmdIndex } from './infrastructure/amd/amd-index';
import { ResolveAmdDefinition } from './application/resolve-amd-definition';
import { ListResolvedAmdCalls } from './application/list-resolved-amd-calls';
import { FindAmdReferences } from './application/find-amd-references';
import { AmdDefinitionProvider } from './presentation/providers/amd-definition-provider';
import { AmdReferenceProvider } from './presentation/providers/amd-reference-provider';
import { ResolveTableDefinition } from './application/resolve-table-definition';
import { ListResolvedTableRefs } from './application/list-resolved-table-refs';
import { TableDefinitionProvider } from './presentation/providers/table-definition-provider';
import { ClassMemberIndex } from './infrastructure/coreapi/class-member-index';
import { ConfigKeyIndex, isDeclarationFile } from './infrastructure/config/config-key-index';
import { CompleteGlobalMembers } from './application/complete-global-members';
import { DescribeGlobalMember } from './application/describe-global-member';
import { ResolveGlobalMemberDefinition } from './application/resolve-global-member-definition';
import { GlobalMemberCompletionProvider } from './presentation/providers/global-member-completion-provider';
import { GlobalHoverProvider } from './presentation/providers/global-hover-provider';
import { GlobalDefinitionProvider } from './presentation/providers/global-definition-provider';
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
  // 타입 맵을 미리 채운다. 동기 조회(경로 역산)가 캐시 미스를 만나면 구성 I/O가 확장 호스트를
  // 막으므로, 프로바이더 등록 전에 비동기로 만들어 둔다.
  await pluginTypeDirsAsync(root);

  registerPhpWordPattern(ctx);
  const status = registerStatusBar(ctx, root);

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
  const findRefs = new FindStringReferences(usageIndex, strings);
  const locate = new LocateStringTarget(syntax, strings);
  // 버튼(CodeLens)·링크(hover)는 개수만 묻는다 — 색인을 깨우는 쪽은 명령과 참조 프로바이더다
  const refCounter = { built: () => usageIndex.isBuilt, count: (c: string, k: string) => findRefs.run(c, k).length };
  const configKeys = new ConfigKeyIndex();
  const findCfgRefs = new FindConfigReferences(usageIndex, configKeys);
  const cfgCounter = { built: () => usageIndex.isBuilt, count: (p: string, k: string) => findCfgRefs.run(p, k).length };
  const counters: ReferenceCounters = { string: refCounter, config: cfgCounter };
  // 사용처 색인이 바뀌면 모든 렌즈의 개수가 달라진다 — 렌즈는 여기 등록하고 한 번에 다시 그린다
  const lenses: UsageCodeLensProvider[] = [];
  const refreshLenses = () => { for (const l of lenses) l.refresh(); };
  const parseLangSafe = (text: string) => { try { return parseLangFile(text); } catch { return []; } };
  const langLens = new UsageCodeLensProvider(doc => {
    const component = componentOfLangFile(root, doc.uri.fsPath);
    return component ? langLensTargets(doc.uri.toString(), parseLangSafe(doc.getText()), component, refCounter) : [];
  }, () => vscode.workspace.getConfiguration('csmscode').get<boolean>('strings.codeLens', true));
  ctx.subscriptions.push(langLens);
  lenses.push(langLens);
  // 사용처 색인은 첫 참조 요청(또는 버튼 클릭)에 만든다 — 활성화 비용 0. 참조 프로바이더 여덟 개와 명령 둘이 이 핸들 하나를 공유한다.
  const usageHandle: UsageIndexHandle = {
    built: () => usageIndex.isBuilt,
    // 빌드가 끝나면 렌즈 라벨이 "사용 찾기"에서 개수로 바뀌어야 한다
    build: cb => usageBuild ?? (usageBuild = usageIndex.buildFromRoot(root, cb).then(refreshLenses)),
  };
  registerShowReferences(ctx, SHOW_STRING_REFERENCES_COMMAND, (c, k) => findRefs.run(c, k), usageHandle);
  const listResolved = new ListResolvedStringCalls(syntax, strings);

  const resolveTpl = new ResolveTemplateDefinition(syntax, templates);
  const findTplRefs = new FindTemplateReferences(usageIndex);
  const listResolvedTpl = new ListResolvedTemplateCalls(syntax, templates);

  const mustacheSelector: vscode.DocumentSelector = { scheme: 'file', pattern: '**/templates/**/*.mustache' };
  const resolveMustache = new ResolveMustacheDefinition(templates, strings);
  const describeMustache = new DescribeMustacheSymbol(templates, strings);
  const listResolvedMustache = new ListResolvedMustacheRefs(templates, strings);

  const resolveAmd = new ResolveAmdDefinition(syntax, amd);
  const listResolvedAmd = new ListResolvedAmdCalls(syntax, amd);
  const findAmdRefs = new FindAmdReferences(usageIndex);

  // 전역 색인은 활성화가 아니라 첫 요청에서 만든다 — 코어 클래스 세 개 파싱과 설정 키 수집이
  // 각각 최대 이벤트 루프 정지 약 30ms·18ms로, 활성화의 한 자릿수 ms 목표를 넘긴다.
  const classMembers = new ClassMemberIndex();
  let globalsBuild: Promise<void> | undefined;
  // 두 색인이 모두 끝나야 준비된 것이다 — 클래스 색인의 플래그만 보면 설정 색인이 비어 있는
  // 900ms 동안 $CFG-> 완성이 조용히 빈 목록을 준다.
  let globalsReady = false;
  // 선언 색인은 첫 요청에서 만든다(활성화 비용 0). 전역 핸들과 같은 Promise를 공유해 두 번 만들지 않는다.
  let configBuild: Promise<void> | undefined;
  let configReady = false;
  const configReadyListeners: Array<() => void> = [];
  const ensureConfig = () => configBuild ??= configKeys.buildFromRootAsync(root).then(() => {
    configReady = true;
    for (const l of configReadyListeners) l();
  }, err => {
    // 실패해도 전역 색인까지 함께 죽이지 않는다 — 설정 기능만 침묵한다
    console.error('CSMS Code: 설정 선언 색인에 실패했습니다.', err);
  });
  const globalsHandle = {
    built: () => globalsReady,
    build: () => globalsBuild ?? (globalsBuild = (async () => {
      await classMembers.buildFromRoot(root, syntax);
      await ensureConfig();
      globalsReady = true;
    })()),
  };

  const locateCfg = new LocateConfigTarget(syntax, configKeys);
  const resolveCfg = new ResolveConfigDefinition(syntax, configKeys);
  const describeCfg = new DescribeConfigKey(syntax, configKeys, uri => path.relative(root, uri));
  const listResolvedCfg = new ListResolvedConfigRefs(syntax, configKeys);
  const completeCfg = new CompleteConfigKeys(configKeys);
  registerShowReferences(ctx, SHOW_CONFIG_REFERENCES_COMMAND, (p, k) => findCfgRefs.run(p, k), usageHandle);
  const settingsSelector: vscode.DocumentSelector = [
    { language: 'php', scheme: 'file', pattern: '**/settings.php' },
    { language: 'php', scheme: 'file', pattern: '**/admin/settings/*.php' },
  ];
  const settingsLens = new UsageCodeLensProvider(doc => {
    if (!configReady) { void ensureConfig(); return []; } // settings.php를 열었다는 것 자체가 요청이다
    return settingsLensTargets(doc.uri.toString(), configKeys.declarationsIn(doc.uri.fsPath), cfgCounter);
  }, () => vscode.workspace.getConfiguration('csmscode').get<boolean>('config.codeLens', true));
  ctx.subscriptions.push(settingsLens);
  lenses.push(settingsLens);
  configReadyListeners.push(() => settingsLens.refresh());
  const completeGlobal = new CompleteGlobalMembers(syntax, classMembers, configKeys, store);
  const describeGlobal = new DescribeGlobalMember(syntax, classMembers, configKeys, store);
  const resolveGlobal = new ResolveGlobalMemberDefinition(syntax, classMembers, configKeys, store);

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
    vscode.languages.registerCodeActionsProvider(php, new SuggestionQuickFixProvider(), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    vscode.languages.registerCompletionItemProvider(php, new StringKeyCompletionProvider(completeStr), "'", '"'),
    vscode.languages.registerDefinitionProvider(php, new StringDefinitionProvider(resolveStr)),
    vscode.languages.registerHoverProvider(php, new StringHoverProvider(describeStr, counters)),
    vscode.languages.registerReferenceProvider(
      { language: 'php', scheme: 'file', pattern: '**/lang/*/*.php' },
      new LangReferenceProvider(findRefs, usageHandle, file => componentOfLangFile(root, file))),
    // 코드 쪽에서도 Shift+F12 — F12가 되는 자리에서 참조만 안 되면 사용자는 버그로 읽는다
    vscode.languages.registerReferenceProvider(php, new TargetReferenceProvider(
      (doc, pos) => locate.php(doc.getText(), doc.offsetAt(pos)), (t, incl) => findRefs.run(t.component, t.key, incl), usageHandle)),
    vscode.languages.registerReferenceProvider(js, new TargetReferenceProvider(
      (doc, pos) => locate.js(doc.getText(), doc.offsetAt(pos)), (t, incl) => findRefs.run(t.component, t.key, incl), usageHandle)),
    vscode.languages.registerReferenceProvider(mustacheSelector, new TargetReferenceProvider(
      (doc, pos) => locate.mustache(doc.getText(), doc.offsetAt(pos)), (t, incl) => findRefs.run(t.component, t.key, incl), usageHandle)),
    vscode.languages.registerCodeLensProvider({ language: 'php', scheme: 'file', pattern: '**/lang/*/*.php' }, langLens),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('csmscode.strings.codeLens')) langLens.refresh(); }),
    vscode.languages.registerDefinitionProvider(php, new TemplateDefinitionProvider(resolveTpl)),
    vscode.languages.registerReferenceProvider(
      { scheme: 'file', pattern: '**/templates/**/*.mustache' },
      new TemplateReferenceProvider(findTplRefs, usageHandle, file => componentOfTemplateFile(root, file))),
    vscode.languages.registerDefinitionProvider(mustacheSelector, new MustacheDefinitionProvider(resolveMustache)),
    vscode.languages.registerHoverProvider(mustacheSelector, new MustacheHoverProvider(describeMustache, counters)),
    vscode.languages.registerDefinitionProvider(php, new TableDefinitionProvider(resolveTbl)),
    vscode.languages.registerCompletionItemProvider(php, new GlobalMemberCompletionProvider(completeGlobal, globalsHandle), '>'),
    vscode.languages.registerHoverProvider(php, new GlobalHoverProvider(describeGlobal, globalsHandle)),
    vscode.languages.registerDefinitionProvider(php, new GlobalDefinitionProvider(resolveGlobal, globalsHandle)),
    vscode.languages.registerDefinitionProvider(php, new AmdDefinitionProvider(resolveAmd)),
    vscode.languages.registerReferenceProvider(
      { scheme: 'file', pattern: '**/amd/src/**/*.js' },
      new AmdReferenceProvider(findAmdRefs, usageHandle, file => componentOfAmdFile(root, file))),
    vscode.languages.registerDefinitionProvider(js, new JsDefinitionProvider(resolveJs)),
    vscode.languages.registerHoverProvider(js, new JsHoverProvider(describeJs, counters)),
    vscode.languages.registerDefinitionProvider(php, new ConfigDefinitionProvider(locateCfg, resolveCfg, ensureConfig)),
    vscode.languages.registerHoverProvider(php, new ConfigHoverProvider(locateCfg, describeCfg, counters, ensureConfig)),
    vscode.languages.registerCompletionItemProvider(php, new ConfigKeyCompletionProvider(completeCfg, ensureConfig), "'", '"'),
    // 코드 쪽은 팩트만으로 대상을 판정하므로 대상이 있을 때만 선언 색인을 깨운다(선언 포함용). settings.php 쪽은 판정 자체에 색인이 필요하다.
    vscode.languages.registerReferenceProvider(php, new TargetReferenceProvider(
      (doc, pos) => locateCfg.php(doc.getText(), doc.offsetAt(pos)), (t, incl) => findCfgRefs.run(t.plugin, t.key, incl), usageHandle, { beforeFind: ensureConfig })),
    vscode.languages.registerReferenceProvider(settingsSelector, new TargetReferenceProvider(
      (doc, pos) => locateCfg.settings(doc.uri.fsPath, pos.line), (t, incl) => findCfgRefs.run(t.plugin, t.key, incl), usageHandle, { beforeLocate: ensureConfig })),
    vscode.languages.registerCodeLensProvider(settingsSelector, settingsLens),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('csmscode.config.codeLens')) settingsLens.refresh(); }),
  );
  const diagnostics = registerDiagnostics(ctx, validate, validateStr);
  const highlight = registerResolvedHighlight(ctx, [
    { setting: 'strings.highlightResolved', languages: ['php'], run: t => listResolved.run(t) },
    { setting: 'templates.highlightResolved', languages: ['php'], run: t => listResolvedTpl.run(t) },
    { setting: 'tables.highlightResolved', languages: ['php'], run: t => listResolvedTbl.run(t) },
    { setting: 'amd.highlightResolved', languages: ['php'], run: t => listResolvedAmd.run(t) },
    { setting: 'templates.highlightResolved', languages: [], pathSuffix: '.mustache', run: t => listResolvedMustache.runTemplates(t) },
    { setting: 'strings.highlightResolved', languages: [], pathSuffix: '.mustache', run: t => listResolvedMustache.runStrings(t) },
    { setting: 'strings.highlightResolved', languages: ['javascript'], run: t => listResolvedJs.runStrings(t) },
    { setting: 'templates.highlightResolved', languages: ['javascript'], run: t => listResolvedJs.runTemplates(t) },
    // 선언 색인이 없으면 설정 호출이 있는 문서에서만 빌드를 시작하고, 끝나면 다시 그린다
    { setting: 'config.highlightResolved', languages: ['php'], run: t => {
      if (configReady) return listResolvedCfg.run(t);
      if (listResolvedCfg.hasCalls(t)) void ensureConfig();
      return [];
    } },
  ]);
  configReadyListeners.push(() => highlight.refreshAll());
  const showIndexCounts = () => status.setReady({
    tables: store.allTableNames().length, strings: strings.size(),
    templates: templates.size(), amd: amd.size(),
  });
  const refreshAll = () => { diagnostics.refreshAll(); highlight.refreshAll(); };
  // 증분 갱신도 숫자에 반영한다 — 멈춰 있는 숫자는 확장이 죽은 것처럼 보인다.
  // 실패 상태를 덮지 않도록 재빌드 경로에서는 성공했을 때만 부른다.
  const refreshAllWithCounts = () => { showIndexCounts(); refreshAll(); };
  // 워처 폭주(예: git checkout으로 lang 수백 개 변경) 시 이벤트마다 전체 갱신하면 낭비가 N배로 쌓인다 —
  // 마지막 한 번만 의미가 있으므로 합친다. 초기 빌드 완료 후 갱신은 단발이라 즉시 호출한다.
  const refreshDebouncer = new KeyedDebouncer(200);
  ctx.subscriptions.push(refreshDebouncer);
  const scheduleRefresh = () => refreshDebouncer.schedule('all', refreshAllWithCounts);

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
   *  재진입도 같은 자리에서 막는다 — 동시에 두 번 돌면 먼저 끝난 쪽이 indexing을 내려버려
   *  아직 도는 빌드가 그 뒤의 증분을 맵 교체로 덮어쓴다.
   *  예외가 나도 finally로 게이트를 반드시 내린다 — 안 내리면 증분 동기화가 세션 내내 죽는다. */
  const gatedRebuild = (): Thenable<void> | void => {
    if (indexing) { pendingReindex = true; return; }
    return runRebuild();
  };
  const runRebuild = () => vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'CSMS Code: 색인 중…' },
    async () => {
      indexing = true;
      status.setIndexing();
      try {
        do {
          pendingReindex = false;
          // 선언이 바뀌었을 수 있는 유일한 지점이다. 비운 채로 두면 그 사이의 동기 조회가
          // 확장 호스트에서 맵을 다시 만들게 되므로 즉시 다시 채운다.
          clearPluginTypeCache(root);
          await pluginTypeDirsAsync(root);
          await buildAll();
        } while (pendingReindex);
        showIndexCounts();
      } catch (err) {
        console.error('CSMS Code: 색인에 실패했습니다.', err);
        // 실패했는데 준비된 것처럼 숫자를 띄우면 확인 수단이 거짓말을 한다.
        status.setFailed(err);
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

  // 플러그인 타입 선언이 바뀌면 맵 자체가 달라져 파일 단위 증분이 불가능하다 — 전체를 다시 만든다.
  const typeDeclWatcher = vscode.workspace.createFileSystemWatcher('**/db/subplugins.{json,php}');
  const componentsWatcher = vscode.workspace.createFileSystemWatcher('**/lib/components.json');
  // git checkout처럼 여러 선언 파일이 한꺼번에 바뀌면 이벤트가 몰아친다 — 마지막 한 번만 의미가 있다.
  const onTypeDecl = () => refreshDebouncer.schedule('typedecl', () => { void gatedRebuild(); });
  ctx.subscriptions.push(typeDeclWatcher, componentsWatcher,
    typeDeclWatcher.onDidChange(onTypeDecl), typeDeclWatcher.onDidCreate(onTypeDecl), typeDeclWatcher.onDidDelete(onTypeDecl),
    componentsWatcher.onDidChange(onTypeDecl), componentsWatcher.onDidCreate(onTypeDecl), componentsWatcher.onDidDelete(onTypeDecl));

  // settings.php 변경 → 선언 색인 그 파일만 갱신(색인이 아직 없으면 다음 빌드가 담는다)
  const settingsWatcher = vscode.workspace.createFileSystemWatcher('**/settings.php');
  const adminSettingsWatcher = vscode.workspace.createFileSystemWatcher('**/admin/settings/*.php');
  const onSettings = (uri: vscode.Uri, removed: boolean) => {
    // 색인 규칙 밖의 파일(클래스 파일 등)은 전체 빌드도 담지 않으므로 증분도 넣지 않는다.
    if (!configBuild || !isDeclarationFile(root, uri.fsPath)) return;
    // 빌드가 진행 중이면 그 뒤에 적용한다 — 빌드가 이미 읽은 옛 내용이 남지 않게
    void configBuild
      .then(() => removed ? configKeys.removeFile(uri.fsPath) : configKeys.updateFile(uri.fsPath))
      .then(() => { settingsLens.refresh(); highlight.refreshAll(); });
  };
  for (const w of [settingsWatcher, adminSettingsWatcher]) {
    ctx.subscriptions.push(w,
      w.onDidChange(u => onSettings(u, false)), w.onDidCreate(u => onSettings(u, false)), w.onDidDelete(u => onSettings(u, true)));
  }

  // 사용처 색인 증분: lazy 빌드 이후에만, 저장된 파일 단위로 재추출
  ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument(d => {
    if (d.uri.scheme === 'file' && usageIndex.isBuilt && isIndexableSourcePath(root, d.uri.fsPath)) {
      usageIndex.updateFileText(d.uri.fsPath, d.getText());
      refreshLenses(); // 개수가 달라졌을 수 있다
    }
  }));

  // 삭제된 파일의 참조는 저장 이벤트가 없어 자가치유되지 않는다 — 빈 텍스트로 증분 제거
  ctx.subscriptions.push(vscode.workspace.onDidDeleteFiles(e => {
    if (!usageIndex.isBuilt) return;
    for (const f of e.files) usageIndex.updateFileText(f.fsPath, '');
    refreshLenses();
  }));
}
export function deactivate() { /* noop */ }
