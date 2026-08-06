import { strict as assert } from 'assert';
import { join } from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { findMoodleRoot, listInstallXmlFiles, listLangFiles, componentOfLangFile, componentOfInstallXmlFile, listInstallXmlFilesAsync, listLangFilesAsync, listTemplateFilesAsync, listTemplateFiles, langFileMetaOf, listAmdFiles, listAmdFilesAsync, componentOfAmdFile, coreSubsystemDirs } from '../../../src/infrastructure/workspace/moodle-root-resolver';
import { LangFileRef, TemplateFileRef, AmdFileRef } from '../../../src/infrastructure/workspace/moodle-root-resolver';

const root = join(__dirname, '../../fixtures/mini-moodle');

describe('MoodleRootResolver', () => {
  it('version.php로 루트 발견', () => assert.equal(findMoodleRoot(root), root));
  it('하위 폴더에서 위로 탐색', () =>
    assert.equal(findMoodleRoot(join(root, 'local/ubattend/db')), root));
  it('install.xml 목록 + 컴포넌트명', () => {
    const list = listInstallXmlFiles(root).map(x => x.component).sort();
    assert.deepEqual(list, ['block_testblock', 'core', 'local_ubattend']);
  });

  // 기본 설정이 하위 폴더 `moodle`을 탐색하므로, 이름만 같은 디렉터리를 루트로 오인하지 않아야 한다.
  describe('하위 폴더 탐색', () => {
    let tmp: string;
    beforeEach(() => { tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-subfolder-')); });
    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

    it('version.php와 lib/db/install.xml이 함께 있으면 하위 폴더를 루트로 본다', () => {
      const sub = join(tmp, 'moodle');
      fs.mkdirSync(join(sub, 'lib', 'db'), { recursive: true });
      fs.writeFileSync(join(sub, 'version.php'), '<?php');
      fs.writeFileSync(join(sub, 'lib', 'db', 'install.xml'), '<XMLDB></XMLDB>');
      assert.equal(findMoodleRoot(tmp, ['moodle']), sub);
    });

    it('version.php만 있으면 루트로 보지 않는다', () => {
      const sub = join(tmp, 'moodle');
      fs.mkdirSync(sub, { recursive: true });
      fs.writeFileSync(join(sub, 'version.php'), '<?php');
      assert.equal(findMoodleRoot(tmp, ['moodle']), undefined);
    });

    it('목록에 없는 폴더명은 탐색하지 않는다', () => {
      const sub = join(tmp, 'moodle');
      fs.mkdirSync(join(sub, 'lib', 'db'), { recursive: true });
      fs.writeFileSync(join(sub, 'version.php'), '<?php');
      fs.writeFileSync(join(sub, 'lib', 'db', 'install.xml'), '<XMLDB></XMLDB>');
      assert.equal(findMoodleRoot(tmp, []), undefined);
    });
  });
});

// symlink 플러그인 색인: Dirent.isDirectory()는 링크를 따라가지 않으므로 심볼릭 링크된
// 플러그인은 별도 확인이 필요하다. 픽스처는 런타임 tmp에 만든다(커밋된 symlink는 Windows에서 깨진다).
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
  it('비동기 열거도 심볼릭 링크를 동일하게 처리', async () => {
    const r = join(tmp, 'root');
    const sync = listInstallXmlFiles(r).map(x => x.component).sort();
    const async_ = (await listInstallXmlFilesAsync(r)).map(x => x.component).sort();
    assert.deepEqual(async_, sync, '동기와 동일해야 함');
    assert.deepEqual(async_, ['core', 'local_linked'], '링크된 플러그인 포함·깨진 링크 제외');
  });
});

describe('MoodleRootResolver — lang 파일 열거', () => {
  it('코어(en)·플러그인(en/ko)·mod 파일명 예외를 컴포넌트·locale과 함께 열거', () => {
    const list = listLangFiles(root).map(x => `${x.component}:${x.locale}`).sort();
    assert.deepEqual(list, ['block_testblock:en', 'core:en', 'core_grades:en', 'local_ubattend:en', 'local_ubattend:ko', 'mod_testmod:en', 'tool_testtool:en']);
  });
});

describe('MoodleRootResolver — langFileMetaOf', () => {
  it('플러그인 ko', () =>
    assert.deepEqual(langFileMetaOf(root, join(root, 'local/ubattend/lang/ko/local_ubattend.php')),
      { component: 'local_ubattend', locale: 'ko' }));
  it('코어 en', () =>
    assert.deepEqual(langFileMetaOf(root, join(root, 'lang/en/moodle.php')), { component: 'core', locale: 'en' }));
  it('규칙 밖 → null', () =>
    assert.equal(langFileMetaOf(root, join(root, 'local/ubattend/lang/ko/wrong.php')), null));
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
  it('blocks 디렉터리(타입명 block)도 역산', () =>
    assert.equal(componentOfLangFile(root, join(root, 'blocks/testblock/lang/en/block_testblock.php')), 'block_testblock'));
  it('중첩 디렉터리(admin/tool)도 역산', () =>
    assert.equal(componentOfLangFile(root, join(root, 'admin/tool/testtool/lang/en/tool_testtool.php')), 'tool_testtool'));
  it('규칙 밖 파일명 → null', () =>
    assert.equal(componentOfLangFile(root, join(root, 'local/ubattend/lang/ko/wrong.php')), null));
  it('루트 밖 경로 → null', () =>
    assert.equal(componentOfLangFile(root, '/etc/passwd'), null));
});

describe('MoodleRootResolver — 비동기 열거는 동기와 동일 결과', () => {
  const norm = (xs: { file: string }[]) => xs.map(x => x.file).sort();

  it('listInstallXmlFilesAsync ≡ listInstallXmlFiles', async () => {
    assert.deepEqual(norm(await listInstallXmlFilesAsync(root)), norm(listInstallXmlFiles(root)));
  });
  it('listLangFilesAsync ≡ listLangFiles (component·locale 포함)', async () => {
    const key = (xs: LangFileRef[]) => xs.map(x => `${x.component}:${x.locale}:${x.file}`).sort();
    assert.deepEqual(key(await listLangFilesAsync(root)), key(listLangFiles(root)));
  });
  it('listTemplateFilesAsync ≡ listTemplateFiles (component·name 포함)', async () => {
    const key = (xs: TemplateFileRef[]) => xs.map(x => `${x.component}/${x.name}:${x.file}`).sort();
    assert.deepEqual(key(await listTemplateFilesAsync(root)), key(listTemplateFiles(root)));
  });
});

describe('MoodleRootResolver — componentOfInstallXmlFile', () => {
  it('코어', () =>
    assert.equal(componentOfInstallXmlFile(root, join(root, 'lib/db/install.xml')), 'core'));
  it('플러그인', () =>
    assert.equal(componentOfInstallXmlFile(root, join(root, 'local/ubattend/db/install.xml')), 'local_ubattend'));
  it('blocks 디렉터리(타입명 block)', () =>
    assert.equal(componentOfInstallXmlFile(root, join(root, 'blocks/testblock/db/install.xml')), 'block_testblock'));
  it('규칙 밖 → null', () => {
    assert.equal(componentOfInstallXmlFile(root, join(root, 'local/ubattend/db/other.xml')), null);
    assert.equal(componentOfInstallXmlFile(root, '/etc/install.xml'), null);
  });
});

describe('MoodleRootResolver — AMD 모듈 열거', () => {
  it('플러그인·코어·코어 서브시스템을 component/name으로 열거하고 amd/build는 제외', () => {
    const list = listAmdFiles(root).map(x => `${x.component}/${x.name}`).sort();
    assert.deepEqual(list, [
      'core/notification', 'core_form/submit',
      'local_ubattend/setting', 'local_ubattend/sub/nested', 'local_ubattend/view',
    ]);
  });

  it('비동기 열거는 동기와 동일', async () => {
    const key = (xs: AmdFileRef[]) => xs.map(x => `${x.component}/${x.name}:${x.file}`).sort();
    assert.deepEqual(key(await listAmdFilesAsync(root)), key(listAmdFiles(root)));
  });

  it('componentOfAmdFile: 열거 결과를 되돌린다', () => {
    for (const ref of listAmdFiles(root)) {
      assert.deepEqual(componentOfAmdFile(root, ref.file), { component: ref.component, name: ref.name });
    }
  });

  it('componentOfAmdFile: amd/build·규칙 밖·루트 밖은 null', () => {
    assert.equal(componentOfAmdFile(root, join(root, 'local/ubattend/amd/build/setting.min.js')), null);
    assert.equal(componentOfAmdFile(root, join(root, 'local/ubattend/classes/thing.php')), null);
    assert.equal(componentOfAmdFile(root, '/etc/passwd'), null);
  });

  it('coreSubsystemDirs: null 값은 제외', () => {
    const m = coreSubsystemDirs(root);
    assert.equal(m.get('form'), 'lib/form');
    assert.ok(!m.has('access'));
  });

  it('coreSubsystemDirs: components.json이 없으면 빈 Map', () => {
    const tmp = fs.mkdtempSync(join(os.tmpdir(), 'csms-nocomp-'));
    assert.equal(coreSubsystemDirs(tmp).size, 0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
