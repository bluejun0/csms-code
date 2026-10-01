import * as path from 'path';
import * as vscode from 'vscode';
import { LangLayout, LangLayoutReader } from '../domain/lang-model/ports/lang-layout-reader';
import { langLensLine } from '../domain/lang-model/services/lang-lens-line';
import { missingTranslations, sortAlphabetically, sortInEnglishOrder, TextReplacement } from '../domain/lang-model/services/lang-string-sorter';

export const SORT_LANG_STRINGS_COMMAND = 'csmscode.sortLangStrings';
export const SORT_LANG_STRINGS_AS_ENGLISH_COMMAND = 'csmscode.sortLangStringsAsEnglish';
export const ADD_MISSING_TRANSLATIONS_COMMAND = 'csmscode.addMissingTranslations';

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

  provideCodeActions(doc: vscode.TextDocument): vscode.CodeAction[] {
    if (!this.isLangFile(doc.uri.fsPath)) return [];
    return commandsFor(doc.uri).map(c => {
      const action = new vscode.CodeAction(c.title, vscode.CodeActionKind.Refactor);
      action.command = { ...c, arguments: [doc.uri] };
      return action;
    });
  }
}
