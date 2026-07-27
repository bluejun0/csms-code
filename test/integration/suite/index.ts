import * as path from 'path';
import * as fs from 'fs';
import Mocha from 'mocha';

// 표준 @vscode/test-electron mocha 로더: 컴파일된(dist-test) *.test.js 를 이 폴더에서 찾아 실행한다.
export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 20000 });
  const testsRoot = path.resolve(__dirname, '.');

  return new Promise((resolve, reject) => {
    try {
      const files = fs.readdirSync(testsRoot).filter(f => f.endsWith('.test.js'));
      files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));
      mocha.run((failures: number) => {
        if (failures > 0) reject(new Error(`${failures}개의 테스트가 실패했습니다.`));
        else resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}
