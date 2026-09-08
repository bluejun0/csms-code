import { strict as assert } from 'assert';
import { releaseFromApi, repoSlugOf } from '../../../src/infrastructure/updates/github-release-source';

const payload = (over: Record<string, unknown> = {}) => ({
  tag_name: 'v0.24.0',
  body: '### 수정\n- 뭔가 고침',
  html_url: 'https://github.com/o/r/releases/tag/v0.24.0',
  draft: false,
  assets: [
    { name: 'source.zip', browser_download_url: 'https://github.com/o/r/releases/download/v0.24.0/source.zip' },
    { name: 'csms-code-0.24.0.vsix', browser_download_url: 'https://github.com/o/r/releases/download/v0.24.0/csms-code-0.24.0.vsix' },
  ],
  ...over,
});

describe('GitHub 릴리스 응답 읽기', () => {
  it('태그·본문·페이지와 .vsix 에셋을 읽는다', () => {
    const r = releaseFromApi(payload());
    assert.equal(r?.version, 'v0.24.0');
    assert.equal(r?.notes, '### 수정\n- 뭔가 고침');
    assert.equal(r?.pageUrl, 'https://github.com/o/r/releases/tag/v0.24.0');
    assert.equal(r?.assetUrl, 'https://github.com/o/r/releases/download/v0.24.0/csms-code-0.24.0.vsix');
  });

  it('.vsix가 아닌 에셋은 고르지 않는다', () => {
    const r = releaseFromApi(payload({ assets: [{ name: 'notes.txt', browser_download_url: 'https://example/notes.txt' }] }));
    assert.equal(r?.assetUrl, undefined, '설치할 파일이 없으면 페이지 열기로만 간다');
    assert.equal(r?.version, 'v0.24.0', '그래도 알림은 가능해야 한다');
  });

  it('github.com 밖의 에셋 URL은 쓰지 않는다 — 이 URL로 파일을 받아 설치한다', () => {
    const r = releaseFromApi(payload({ assets: [
      { name: 'evil.vsix', browser_download_url: 'https://evil.example/evil.vsix' },
    ] }));
    assert.equal(r?.assetUrl, undefined);
  });

  it('http는 쓰지 않는다', () => {
    const r = releaseFromApi(payload({ assets: [
      { name: 'a.vsix', browser_download_url: 'http://github.com/o/r/a.vsix' },
    ] }));
    assert.equal(r?.assetUrl, undefined);
  });

  it('본문이 비어 있어도 읽는다', () => {
    assert.equal(releaseFromApi(payload({ body: null }))?.notes, '');
  });

  it('태그가 없으면 릴리스로 보지 않는다', () => {
    assert.equal(releaseFromApi(payload({ tag_name: undefined })), undefined);
  });

  it('초안은 릴리스로 보지 않는다', () => {
    assert.equal(releaseFromApi(payload({ draft: true })), undefined);
  });

  it('응답이 객체가 아니면 undefined', () => {
    assert.equal(releaseFromApi(null), undefined);
    assert.equal(releaseFromApi('그냥 문자열'), undefined);
  });
});

describe('저장소 주소 읽기', () => {
  it('package.json의 git URL에서 owner/repo를 뽑는다', () => {
    assert.equal(repoSlugOf('https://github.com/bluejun0/csms-code.git'), 'bluejun0/csms-code');
    assert.equal(repoSlugOf('https://github.com/bluejun0/csms-code'), 'bluejun0/csms-code');
    assert.equal(repoSlugOf('git+https://github.com/bluejun0/csms-code.git'), 'bluejun0/csms-code');
  });

  it('GitHub이 아니거나 형태가 다르면 undefined', () => {
    assert.equal(repoSlugOf('https://gitlab.com/a/b.git'), undefined);
    assert.equal(repoSlugOf(''), undefined);
    assert.equal(repoSlugOf(undefined), undefined);
  });
});
