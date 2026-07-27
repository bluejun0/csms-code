import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

const root = path.resolve(__dirname, '../../../test/fixtures/mini-moodle');

suite('DB 인텔리전스 통합', () => {
  test('$c->coursid 오타 진단 발생', async () => {
    const uri = vscode.Uri.file(path.join(root, 'local/ubattend/probe.php'));
    const content = "<?php\nfunction f(){ $c = $DB->get_record('local_ubattend_config', ['id'=>1]); echo $c->coursid; }\n";
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await new Promise(r => setTimeout(r, 1500)); // 색인+진단 대기
    const diags = vscode.languages.getDiagnostics(uri);
    assert.ok(diags.some(d => /coursid/.test(d.message)), '오타 진단이 있어야 함');
  });
});
