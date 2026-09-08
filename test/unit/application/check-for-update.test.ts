import { strict as assert } from 'assert';
import { ReleaseInfo } from '../../../src/domain/updates/release';
import { ReleaseSource } from '../../../src/domain/updates/ports/release-source';
import { CheckForUpdate, CHECK_INTERVAL_MS } from '../../../src/application/check-for-update';

const release = (version: string): ReleaseInfo => ({
  version, notes: '### 수정\n- 뭔가 고침', pageUrl: 'https://example/releases/tag/v' + version,
  assetUrl: 'https://github.com/o/r/releases/download/v' + version + '/csms-code.vsix',
});

const sourceOf = (r: ReleaseInfo | undefined): ReleaseSource => ({ latest: async () => r });
const failing = (): ReleaseSource => ({ latest: async () => { throw new Error('네트워크 없음'); } });

const NOW = 1_700_000_000_000;
const auto = { throttle: true };
const manual = { throttle: false };

describe('업데이트 확인 — 자동(하루 1회)', () => {
  it('더 새 버전이면 알린다', async () => {
    const r = await new CheckForUpdate(sourceOf(release('0.24.0')), '0.23.2').run({}, NOW, auto);
    assert.equal(r.kind, 'available');
    assert.equal(r.kind === 'available' ? r.release.version : undefined, '0.24.0');
  });

  it('같은 버전이면 최신이다', async () => {
    const r = await new CheckForUpdate(sourceOf(release('0.23.2')), '0.23.2').run({}, NOW, auto);
    assert.equal(r.kind, 'upToDate');
  });

  it('더 낮은 버전도 최신으로 본다 — 앞선 판을 쓰는 중일 수 있다', async () => {
    const r = await new CheckForUpdate(sourceOf(release('0.23.1')), '0.23.2').run({}, NOW, auto);
    assert.equal(r.kind, 'upToDate');
  });

  it('자릿수가 늘어난 버전을 문자열로 비교하지 않는다', async () => {
    const r = await new CheckForUpdate(sourceOf(release('0.23.10')), '0.23.9').run({}, NOW, auto);
    assert.equal(r.kind, 'available', '0.23.10이 0.23.9보다 새 버전이어야 한다');
  });

  it('건너뛴 버전은 skipped로 구분한다 — 자동은 조용히 넘긴다', async () => {
    const r = await new CheckForUpdate(sourceOf(release('0.24.0')), '0.23.2')
      .run({ skippedVersion: '0.24.0' }, NOW, auto);
    assert.equal(r.kind, 'skipped');
  });

  it('건너뛴 버전보다 더 새 버전은 알린다', async () => {
    const r = await new CheckForUpdate(sourceOf(release('0.25.0')), '0.23.2')
      .run({ skippedVersion: '0.24.0' }, NOW, auto);
    assert.equal(r.kind, 'available');
  });

  it('하루가 안 지났으면 조회조차 하지 않는다', async () => {
    let called = 0;
    const source: ReleaseSource = { latest: async () => { called++; return release('0.24.0'); } };
    const r = await new CheckForUpdate(source, '0.23.2')
      .run({ lastCheckedAt: NOW - CHECK_INTERVAL_MS + 1000 }, NOW, auto);
    assert.equal(called, 0, '조회를 건너뛰어야 한다');
    assert.equal(r.kind, 'throttled');
  });

  it('하루가 지났으면 다시 조회한다', async () => {
    const r = await new CheckForUpdate(sourceOf(release('0.24.0')), '0.23.2')
      .run({ lastCheckedAt: NOW - CHECK_INTERVAL_MS }, NOW, auto);
    assert.equal(r.kind, 'available');
  });

  it('조회 실패는 failed다 — 던지지 않는다', async () => {
    const r = await new CheckForUpdate(failing(), '0.23.2').run({}, NOW, auto);
    assert.equal(r.kind, 'failed');
  });

  it('릴리스가 없으면 failed로 본다 — 최신이라고 단정할 근거가 없다', async () => {
    const r = await new CheckForUpdate(sourceOf(undefined), '0.23.2').run({}, NOW, auto);
    assert.equal(r.kind, 'failed');
  });

  it('v 접두사가 붙은 태그도 버전으로 읽는다', async () => {
    const r = await new CheckForUpdate(sourceOf(release('v0.24.0')), '0.23.2').run({}, NOW, auto);
    assert.equal(r.kind, 'available');
  });
});

describe('업데이트 확인 — 수동 호출', () => {
  it('하루가 안 지났어도 조회한다 — 눌렀으면 지금 확인해야 한다', async () => {
    let called = 0;
    const source: ReleaseSource = { latest: async () => { called++; return release('0.24.0'); } };
    const r = await new CheckForUpdate(source, '0.23.2')
      .run({ lastCheckedAt: NOW - 1000 }, NOW, manual);
    assert.equal(called, 1);
    assert.equal(r.kind, 'available');
  });

  it('건너뛴 버전도 available로 준다 — 직접 물었으면 답해야 한다', async () => {
    const r = await new CheckForUpdate(sourceOf(release('0.24.0')), '0.23.2')
      .run({ skippedVersion: '0.24.0' }, NOW, manual);
    assert.equal(r.kind, 'available');
  });

  it('최신이면 upToDate로 준다 — 호출부가 "최신입니다"를 말할 근거', async () => {
    const r = await new CheckForUpdate(sourceOf(release('0.23.2')), '0.23.2').run({}, NOW, manual);
    assert.equal(r.kind, 'upToDate');
  });

  it('실패는 failed로 준다 — 수동 호출은 침묵하면 고장으로 보인다', async () => {
    const r = await new CheckForUpdate(failing(), '0.23.2').run({}, NOW, manual);
    assert.equal(r.kind, 'failed');
  });
});
