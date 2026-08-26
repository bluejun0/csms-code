import * as vscode from 'vscode';
import { LocateConfigTarget } from '../../application/locate-config-target';
import { ResolveConfigDefinition } from '../../application/resolve-config-definition';
import { toVscodeLocation } from '../mappers';

/** 설정 키에서 F12 → settings.php 선언. 커서가 설정 호출 위일 때만 선언 색인을 깨운다(무관한 F12는 비용 0). */
export class ConfigDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private locate: LocateConfigTarget, private uc: ResolveConfigDefinition, private ready: () => Promise<void>) {}
  async provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Location[]> {
    const text = doc.getText(), at = doc.offsetAt(pos);
    if (!this.locate.php(text, at)) return [];
    await this.ready();
    return this.uc.run(text, at).map(r => toVscodeLocation(r.location));
  }
}
