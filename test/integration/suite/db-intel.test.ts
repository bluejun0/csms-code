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

suite('lang 문자열 정렬 통합', () => {
  test('버튼이 첫 $string 줄에 있고, 명령이 키 순으로 정렬해 저장한다', async () => {
    const uri = vscode.Uri.file(path.join(root, 'local/ubattend/lang/ko/local_ubattend.php'));
    const original = await vscode.workspace.fs.readFile(uri);
    try {
      const unsorted = "<?php\n\n$string['b'] = 'B';\n// a 설명\n$string['a'] = 'A';\n";
      await vscode.workspace.fs.writeFile(uri, Buffer.from(unsorted));
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
      const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', uri);
      const sortLens = lenses.find(l => l.command?.command === 'csmscode.sortLangStrings');
      assert.equal(sortLens?.range.start.line, 2);
      await vscode.commands.executeCommand('csmscode.sortLangStrings', uri);
      const saved = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      assert.equal(saved, "<?php\n\n// a 설명\n$string['a'] = 'A';\n$string['b'] = 'B';\n");
    } finally {
      await vscode.workspace.fs.writeFile(uri, original);
    }
  });
});
