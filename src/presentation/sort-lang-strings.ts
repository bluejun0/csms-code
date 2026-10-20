import * as path from 'path';
import * as vscode from 'vscode';
import { LangLayout, LangLayoutReader } from '../domain/lang-model/ports/lang-layout-reader';
import { langLensLine } from '../domain/lang-model/services/lang-lens-line';
import { missingTranslations, sortAlphabetically, sortAlphabeticallyWithin, sortInEnglishOrder, statementsWithin, TextReplacement } from '../domain/lang-model/services/lang-string-sorter';
import { selectedLines } from './selected-lines';

export const SORT_LANG_STRINGS_COMMAND = 'csmscode.sortLangStrings';
export const SORT_LANG_STRINGS_AS_ENGLISH_COMMAND = 'csmscode.sortLangStringsAsEnglish';
export const ADD_MISSING_TRANSLATIONS_COMMAND = 'csmscode.addMissingTranslations';
export const SORT_SELECTED_LANG_STRINGS_COMMAND = 'csmscode.sortSelectedLangStrings';

interface LangCommand { command: string; title: string; }

const SORT_ALPHABETICALLY: LangCommand = { command: SORT_LANG_STRINGS_COMMAND, title: '알파벳순 정렬' };
const ADD_MISSING: LangCommand = { command: ADD_MISSING_TRANSLATIONS_COMMAND, title: '누락 번역 추가' };
const SORT_AS_ENGLISH: LangCommand = { command: SORT_LANG_STRINGS_AS_ENGLISH_COMMAND, title: '영어 파일 순서로 정렬' };

const isEnglish = (uri: vscode.Uri) => path.basename(path.dirname(uri.fsPath)) === 'en';
const englishUriOf = (uri: vscode.Uri) =>
  vscode.Uri.file(path.join(path.dirname(path.dirname(uri.fsPath)), 'en', path.basename(uri.fsPath)));

function commandsFor(uri: vscode.Uri): LangCommand[] {
  return isEnglish(uri) ? [SORT_ALPHABETICALLY] : [SORT_ALPHABETICALLY, ADD_MISSING, SORT_AS_ENGLISH];
}

export function registerLangStringCommands(ctx: vscode.ExtensionContext, reader: LangLayoutReader,
                                           isLangFile: (fsPath: string) => boolean): void {
  const layoutOf = (doc: vscode.TextDocument): LangLayout =>
    reader.langLayout(doc.getText()) ?? { statements: [], firstCodeLine: null, comments: [] };

  const targetDocument = async (uri?: vscode.Uri): Promise<vscode.TextDocument | null> => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target || !isLangFile(target.fsPath)) {
      vscode.window.showInformationMessage('CSMS Code: lang 파일에서만 쓸 수 있습니다.');
      return null;
    }
    return vscode.workspace.openTextDocument(target);
  };

  const englishDocument = async (doc: vscode.TextDocument): Promise<vscode.TextDocument | null> => {
    const english = englishUriOf(doc.uri);
    try {
      return await vscode.workspace.openTextDocument(english);
    } catch {
      vscode.window.showInformationMessage(`CSMS Code: 영어 lang 파일이 없습니다 — ${vscode.workspace.asRelativePath(english)}`);
      return null;
    }
  };

  const replaceAndSave = async (doc: vscode.TextDocument, change: TextReplacement | null) => {
    if (!change) return;
    const range = new vscode.Range(doc.positionAt(change.start), doc.positionAt(change.end));
    if (doc.getText(range) !== change.replacement) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(doc.uri, range, change.replacement);
      if (!await vscode.workspace.applyEdit(edit)) return;
    }
    await doc.save();
  };

  ctx.subscriptions.push(
    vscode.commands.registerCommand(SORT_LANG_STRINGS_COMMAND, async (uri?: vscode.Uri) => {
      const doc = await targetDocument(uri);
      if (doc) await replaceAndSave(doc, sortAlphabetically(doc.getText(), layoutOf(doc)));
    }),
    vscode.commands.registerCommand(SORT_SELECTED_LANG_STRINGS_COMMAND, async (uri?: vscode.Uri, range?: vscode.Range) => {
      const editor = vscode.window.activeTextEditor;
      const doc = await targetDocument(uri ?? editor?.document.uri);
      const selection = range ?? (editor?.document === doc ? editor?.selection : undefined);
      if (!doc || !selection || selection.isEmpty) {
        if (doc) vscode.window.showInformationMessage('CSMS Code: 정렬할 줄을 먼저 선택하세요.');
        return;
      }
      const { first, last } = selectedLines(selection);
      const change = sortAlphabeticallyWithin(doc.getText(), layoutOf(doc), first, last);
      if (!change) {
        vscode.window.showInformationMessage('CSMS Code: 선택한 줄에 통째로 든 $string이 없습니다.');
        return;
      }
      const start = doc.positionAt(change.start);
      await replaceAndSave(doc, change);
      const end = doc.positionAt(change.start + change.replacement.length);
      const shown = vscode.window.visibleTextEditors.find(e => e.document === doc);
      if (shown) shown.selection = new vscode.Selection(start, end);
    }),
    vscode.commands.registerCommand(SORT_LANG_STRINGS_AS_ENGLISH_COMMAND, async (uri?: vscode.Uri) => {
      const doc = await targetDocument(uri);
      const english = doc && await englishDocument(doc);
      if (doc && english) await replaceAndSave(doc, sortInEnglishOrder(doc.getText(), layoutOf(doc), layoutOf(english)));
    }),
    vscode.commands.registerCommand(ADD_MISSING_TRANSLATIONS_COMMAND, async (uri?: vscode.Uri) => {
      const doc = await targetDocument(uri);
      const english = doc && await englishDocument(doc);
      if (!doc || !english) return;
      const missing = missingTranslations(doc.getText(), layoutOf(doc), english.getText(), layoutOf(english));
      if (!missing) {
        vscode.window.showInformationMessage('CSMS Code: 누락된 번역이 없습니다.');
        return;
      }
      const at = doc.positionAt(missing.insertAt);
      const edit = new vscode.WorkspaceEdit();
      edit.insert(doc.uri, at, missing.insertion);
      if (!await vscode.workspace.applyEdit(edit)) return;
      vscode.window.visibleTextEditors.find(e => e.document === doc)?.revealRange(new vscode.Range(at, at));
      vscode.window.showInformationMessage(`CSMS Code: 문자열 ${missing.count}개를 파일 끝에 추가했습니다.`);
    }),
  );
}

export class LangStringCommandsProvider implements vscode.CodeLensProvider, vscode.CodeActionProvider, vscode.Disposable {
  static readonly actionKinds = [vscode.CodeActionKind.Refactor];

  private changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;

  constructor(private reader: LangLayoutReader, private isLangFile: (fsPath: string) => boolean,
              private lensEnabled: () => boolean) {}

  refresh(): void { this.changed.fire(); }
  dispose(): void { this.changed.dispose(); }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.lensEnabled() || !this.isLangFile(doc.uri.fsPath)) return [];
    const text = doc.getText();
    const layout = this.reader.langLayout(text);
    if (!layout) return [];
    const line = langLensLine(text, layout);
    return commandsFor(doc.uri).map(c =>
      new vscode.CodeLens(new vscode.Range(line, 0, line, 0), { ...c, arguments: [doc.uri] }));
  }

  provideCodeActions(doc: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
    if (!this.isLangFile(doc.uri.fsPath)) return [];
    const actions = commandsFor(doc.uri).map(c => refactor(c.title, { ...c, arguments: [doc.uri] }));
    if (this.selectsSeveralStrings(doc, range)) {
      actions.unshift(refactor(SORT_SELECTED_TITLE,
        { command: SORT_SELECTED_LANG_STRINGS_COMMAND, title: SORT_SELECTED_TITLE, arguments: [doc.uri, range] }));
    }
    return actions;
  }

  /** 커서만 옮겨도 전구가 다시 물어 오므로 선택이 있을 때만 파싱한다. */
  private selectsSeveralStrings(doc: vscode.TextDocument, range: vscode.Range): boolean {
    if (range.isEmpty) return false;
    const layout = this.reader.langLayout(doc.getText());
    const { first, last } = selectedLines(range);
    return !!layout && statementsWithin(layout, first, last).length > 1;
  }
}

const SORT_SELECTED_TITLE = '선택한 문자열 알파벳순 정렬';

function refactor(title: string, command: vscode.Command): vscode.CodeAction {
  const action = new vscode.CodeAction(title, vscode.CodeActionKind.Refactor);
  action.command = command;
  return action;
}
