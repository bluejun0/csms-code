import * as vscode from 'vscode';
import { LocateConfigTarget } from '../../application/locate-config-target';
import { DescribeConfigKey } from '../../application/describe-config-key';
import { ReferenceCounters, hoverWithReferences } from '../references-hover';

export class ConfigHoverProvider implements vscode.HoverProvider {
  constructor(private locate: LocateConfigTarget, private uc: DescribeConfigKey,
              private counters: ReferenceCounters, private ready: () => Promise<void>) {}
  async provideHover(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Hover | null> {
    const text = doc.getText(), at = doc.offsetAt(pos);
    if (!this.locate.php(text, at)) return null;
    await this.ready();
    const r = this.uc.run(text, at);
    return r ? hoverWithReferences(doc, pos, r, this.counters) : null;
  }
}
