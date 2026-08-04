import { strict as assert } from 'assert';
import { join } from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { findMoodleRoot, listInstallXmlFiles } from '../../../src/infrastructure/workspace/moodle-root-resolver';

const root = join(__dirname, '../../fixtures/mini-moodle');

describe('MoodleRootResolver', () => {
  it('version.php로 루트 발견', () => assert.equal(findMoodleRoot(root), root));
  it('하위 폴더에서 위로 탐색', () =>
    assert.equal(findMoodleRoot(join(root, 'local/ubattend/db')), root));
  it('install.xml 목록 + 컴포넌트명', () => {
    const list = listInstallXmlFiles(root).map(x => x.component).sort();
    assert.deepEqual(list, ['core', 'local_ubattend']); // lib/db → core, local/ubattend/db → local_ubattend
  });
});

// symlink 플러그인 색인 (스펙 2026-08-04): Dirent.isDirectory()는 링크를 따라가지 않아
// 심볼릭 링크된 플러그인이 열거에서 탈락했다. 픽스처는 런타임 tmp 생성(커밋된 symlink는 Windows 파손).
describe('MoodleRootResolver — symlink 플러그인 색인', () => {
  let tmp: string;
  before(() => {
    tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-symlink-'));
    // 플러그인 본체(루트 밖 위치를 흉내)
    fs.mkdirSync(join(tmp, 'target', 'db'), { recursive: true });
    fs.writeFileSync(join(tmp, 'target', 'db', 'install.xml'), '<XMLDB/>');
    // Moodle 루트 + 링크된 플러그인
    fs.mkdirSync(join(tmp, 'root', 'lib', 'db'), { recursive: true });
    fs.writeFileSync(join(tmp, 'root', 'version.php'), '<?php');
    fs.writeFileSync(join(tmp, 'root', 'lib', 'db', 'install.xml'), '<XMLDB/>');
    fs.mkdirSync(join(tmp, 'root', 'local'));
    fs.symlinkSync(join(tmp, 'target'), join(tmp, 'root', 'local', 'linked'), 'dir');
  });
  after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('심볼릭 링크된 플러그인 디렉터리도 열거된다', () => {
    const list = listInstallXmlFiles(join(tmp, 'root')).map(x => x.component).sort();
    assert.deepEqual(list, ['core', 'local_linked']);
  });
  it('깨진 심볼릭 링크는 조용히 제외(크래시 없음)', () => {
    fs.symlinkSync(join(tmp, 'nowhere'), join(tmp, 'root', 'local', 'broken'), 'dir');
    const list = listInstallXmlFiles(join(tmp, 'root')).map(x => x.component).sort();
    assert.deepEqual(list, ['core', 'local_linked']);
  });
});
