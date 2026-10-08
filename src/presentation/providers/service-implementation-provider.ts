import * as vscode from 'vscode';
import { ResolveServiceImplementation } from '../../application/resolve-service-implementation';
import { toVscodeLocationLink } from '../mappers';

export const SERVICES_SELECTOR: vscode.DocumentSelector = { language: 'php', scheme: 'file', pattern: '**/db/services.php' };
export const OPEN_SERVICE_IMPLEMENTATION_COMMAND = 'csmscode.openServiceImplementation';

/** services.php의 `classname`·`methodname` 값에서 F12·Ctrl+클릭 → 구현 클래스·메서드. */
export class ServiceImplementationDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private uc: ResolveServiceImplementation, private componentOf: (fsPath: string) => string | null) {}
  provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): vscode.LocationLink[] {
    const component = this.componentOf(doc.uri.fsPath);
    if (!component) return [];
    return this.uc.run(doc.getText(), component, pos.line, pos.character).map(toVscodeLocationLink);
  }
}

/** API 뷰 항목의 "구현으로 이동" 버튼. 항목은 함수 이름(label)과 선언 위치(services.php)를 들고 있다. */
interface ApiNode { component: string; item: { label: string; location: { uri: string } } }

export function registerOpenServiceImplementation(ctx: vscode.ExtensionContext, uc: ResolveServiceImplementation): void {
  ctx.subscriptions.push(vscode.commands.registerCommand(OPEN_SERVICE_IMPLEMENTATION_COMMAND,
    async (node?: ApiNode) => {
      if (!node) return;
      const name = node.item.label;
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(node.item.location.uri));
      const at = uc.locate(doc.getText(), node.component, name);
      if (!at) {
        vscode.window.showInformationMessage(`CSMS Code: ${name}의 구현을 찾지 못했습니다.`);
        return;
      }
      const position = new vscode.Position(at.line, at.column);
      await vscode.window.showTextDocument(vscode.Uri.file(at.uri), { selection: new vscode.Range(position, position) });
    }));
}
