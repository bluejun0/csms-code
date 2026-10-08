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
  test('버튼이 첫 $string 줄에 있고, 알파벳순 정렬 명령이 키 순으로 정렬해 저장한다', async () => {
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
      for (const command of ['csmscode.addMissingTranslations', 'csmscode.sortLangStringsAsEnglish']) {
        assert.ok(lenses.some(l => l.command?.command === command), `영어가 아닌 파일에는 ${command} 버튼도 있어야 함`);
      }
      await vscode.commands.executeCommand('csmscode.sortLangStrings', uri);
      const saved = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      assert.equal(saved, "<?php\n\n// a 설명\n$string['a'] = 'A';\n$string['b'] = 'B';\n");
    } finally {
      await vscode.workspace.fs.writeFile(uri, original);
    }
  });
});

suite('services.php 구현 링크 통합', () => {
  test('classname·methodname에서 정의 이동이 구현 메서드로 간다', async () => {
    const services = vscode.Uri.file(path.join(root, 'local/ubattend/db/services.php'));
    const classesDir = vscode.Uri.file(path.join(root, 'local/ubattend/classes'));
    const impl = vscode.Uri.joinPath(classesDir, 'external/probe_api.php');
    const original = await vscode.workspace.fs.readFile(services);
    try {
      await vscode.workspace.fs.writeFile(impl, Buffer.from(
        "<?php\nnamespace local_ubattend\\external;\n\nclass probe_api {\n    public static function execute() {}\n}\n"));
      await vscode.workspace.fs.writeFile(services, Buffer.from(
        "<?php\n$functions = [\n    'local_ubattend_probe' => [\n        'classname' => 'local_ubattend\\external\\probe_api',\n        'methodname' => 'execute',\n    ],\n];\n"));
      const doc = await vscode.workspace.openTextDocument(services);
      await vscode.window.showTextDocument(doc);
      const methodLinks = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
        'vscode.executeDefinitionProvider', services, new vscode.Position(4, 27));
      const target = methodLinks.map(l => 'targetUri' in l ? l : { targetUri: l.uri, targetRange: l.range })
        .find(l => l.targetUri.fsPath === impl.fsPath);
      assert.equal(target?.targetRange.start.line, 4);
    } finally {
      await vscode.workspace.fs.writeFile(services, original);
      await vscode.workspace.fs.delete(classesDir, { recursive: true });
    }
  });
});
