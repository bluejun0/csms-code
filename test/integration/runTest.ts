import * as path from 'path';
import { runTests } from '@vscode/test-electron';
async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  const workspace = path.resolve(__dirname, '../../test/fixtures/mini-moodle');
  await runTests({ extensionDevelopmentPath, extensionTestsPath, launchArgs: [workspace, '--disable-extensions'] });
}
main();
