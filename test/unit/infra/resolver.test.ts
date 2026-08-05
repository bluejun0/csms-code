import { strict as assert } from 'assert';
import { join } from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { findMoodleRoot, listInstallXmlFiles, listLangFiles, componentOfLangFile } from '../../../src/infrastructure/workspace/moodle-root-resolver';

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
  before(function () {
    tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-symlink-'));
    // 플러그인 본체(루트 밖 위치를 흉내)
    fs.mkdirSync(join(tmp, 'target', 'db'), { recursive: true });
    fs.writeFileSync(join(tmp, 'target', 'db', 'install.xml'), '<XMLDB/>');
    // Moodle 루트 + 링크된 플러그인
    fs.mkdirSync(join(tmp, 'root', 'lib', 'db'), { recursive: true });
    fs.writeFileSync(join(tmp, 'root', 'version.php'), '<?php');
    fs.writeFileSync(join(tmp, 'root', 'lib', 'db', 'install.xml'), '<XMLDB/>');
    fs.mkdirSync(join(tmp, 'root', 'local'));
    try {
      fs.symlinkSync(join(tmp, 'target'), join(tmp, 'root', 'local', 'linked'), 'dir');
    } catch (err) {
      // Windows는 개발자 모드/관리자 없이 symlink 생성이 EPERM — 이 환경에선 describe 전체를 건너뛴다
      if ((err as NodeJS.ErrnoException).code === 'EPERM') { this.skip(); return; }
      throw err;
    }
    // 깨진 링크도 여기서 만들어 픽스처를 정적으로 유지(테스트가 픽스처를 변형하지 않도록)
    fs.symlinkSync(join(tmp, 'nowhere'), join(tmp, 'root', 'local', 'broken'), 'dir');
  });
  after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('심볼릭 링크된 플러그인 디렉터리도 열거된다', () => {
    const list = listInstallXmlFiles(join(tmp, 'root')).map(x => x.component).sort();
    assert.deepEqual(list, ['core', 'local_linked']);
  });
  it('깨진 심볼릭 링크는 조용히 제외(크래시 없음)', () => {
    const list = listInstallXmlFiles(join(tmp, 'root')).map(x => x.component).sort();
    assert.deepEqual(list, ['core', 'local_linked']);
  });
});

describe('MoodleRootResolver — lang 파일 열거', () => {
  it('코어(en)·플러그인(en/ko)·mod 파일명 예외를 컴포넌트·locale과 함께 열거', () => {
    const list = listLangFiles(root).map(x => `${x.component}:${x.locale}`).sort();
    assert.deepEqual(list, ['core:en', 'core_grades:en', 'local_ubattend:en', 'local_ubattend:ko', 'mod_testmod:en']);
  });
});

describe('MoodleRootResolver — componentOfLangFile (경로 역산)', () => {
  it('코어: lang/en/moodle.php → core', () =>
    assert.equal(componentOfLangFile(root, join(root, 'lang/en/moodle.php')), 'core'));
  it('코어 서브시스템: lang/en/grades.php → core_grades', () =>
    assert.equal(componentOfLangFile(root, join(root, 'lang/en/grades.php')), 'core_grades'));
  it('플러그인: local/ubattend/lang/ko/local_ubattend.php → local_ubattend', () =>
    assert.equal(componentOfLangFile(root, join(root, 'local/ubattend/lang/ko/local_ubattend.php')), 'local_ubattend'));
  it('mod 파일명 예외: mod/testmod/lang/en/testmod.php → mod_testmod', () =>
    assert.equal(componentOfLangFile(root, join(root, 'mod/testmod/lang/en/testmod.php')), 'mod_testmod'));
  it('규칙 밖 파일명 → null', () =>
    assert.equal(componentOfLangFile(root, join(root, 'local/ubattend/lang/ko/wrong.php')), null));
  it('루트 밖 경로 → null', () =>
    assert.equal(componentOfLangFile(root, '/etc/passwd'), null));
});
