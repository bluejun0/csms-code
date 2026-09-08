import { strict as assert } from 'assert';
import { ReleaseInfo } from '../../../src/domain/updates/release';
import { ReleaseSource } from '../../../src/domain/updates/ports/release-source';
import { CheckForUpdate, CHECK_INTERVAL_MS } from '../../../src/application/check-for-update';

const release = (version: string): ReleaseInfo => ({
  version, notes: '### 수정\n- 뭔가 고침', pageUrl: 'https://example/releases/tag/v' + version,
  assetUrl: 'https://example/csms-code-' + version + '.vsix',
});

const sourceOf = (r: ReleaseInfo | undefined): ReleaseSource => ({ latest: async () => r });
const failing = (): ReleaseSource => ({ latest: async () => { throw new Error('네트워크 없음'); } });

const NOW = 1_700_000_000_000;

describe('업데이트 확인', () => {
  it('더 새 버전이면 알린다', async () => {
    const r = await new CheckForUpdate(sourceOf(release('0.24.0')), '0.23.2').run({}, NOW);
    assert.equal(r.notify?.version, '0.24.0');
    assert.equal(r.checked, true);
  });

  it('같은 버전이면 알리지 않는다', async () => {
    const r = await new CheckForUpdate(sourceOf(release('0.23.2')), '0.23.2').run({}, NOW);
    assert.equal(r.notify, undefined);
  });

  it('더 낮은 버전이면 알리지 않는다 — 앞선 판을 쓰는 중일 수 있다', async () => {
    const r = await new CheckForUpdate(sourceOf(release('0.23.1')), '0.23.2').run({}, NOW);
    assert.equal(r.notify, undefined);
  });

  it('자릿수가 늘어난 버전을 문자열로 비교하지 않는다', async () => {
    const r = await new CheckForUpdate(sourceOf(release('0.23.10')), '0.23.9').run({}, NOW);
    assert.equal(r.notify?.version, '0.23.10', '0.23.10이 0.23.9보다 새 버전이어야 한다');
  });

  it('건너뛴 버전은 알리지 않는다', async () => {
    const r = await new CheckForUpdate(sourceOf(release('0.24.0')), '0.23.2')
      .run({ skippedVersion: '0.24.0' }, NOW);
    assert.equal(r.notify, undefined);
  });

  it('건너뛴 버전보다 더 새 버전은 알린다', async () => {
    const r = await new CheckForUpdate(sourceOf(release('0.25.0')), '0.23.2')
      .run({ skippedVersion: '0.24.0' }, NOW);
    assert.equal(r.notify?.version, '0.25.0');
  });

  it('마지막 확인이 하루가 안 지났으면 조회조차 하지 않는다', async () => {
    let called = 0;
    const source: ReleaseSource = { latest: async () => { called++; return release('0.24.0'); } };
    const r = await new CheckForUpdate(source, '0.23.2')
      .run({ lastCheckedAt: NOW - CHECK_INTERVAL_MS + 1000 }, NOW);
    assert.equal(called, 0, '조회를 건너뛰어야 한다');
    assert.equal(r.checked, false);
    assert.equal(r.notify, undefined);
  });

  it('하루가 지났으면 다시 조회한다', async () => {
    const r = await new CheckForUpdate(sourceOf(release('0.24.0')), '0.23.2')
      .run({ lastCheckedAt: NOW - CHECK_INTERVAL_MS }, NOW);
    assert.equal(r.checked, true);
    assert.equal(r.notify?.version, '0.24.0');
  });

  it('조회가 실패해도 던지지 않고 조용히 끝난다', async () => {
    const r = await new CheckForUpdate(failing(), '0.23.2').run({}, NOW);
    assert.equal(r.notify, undefined);
    assert.equal(r.checked, true, '실패도 확인 시도로 쳐서 매번 재시도하지 않는다');
  });

  it('릴리스가 없으면 알리지 않는다', async () => {
    const r = await new CheckForUpdate(sourceOf(undefined), '0.23.2').run({}, NOW);
    assert.equal(r.notify, undefined);
  });

  it('v 접두사가 붙은 태그도 버전으로 읽는다', async () => {
    const r = await new CheckForUpdate(sourceOf(release('v0.24.0')), '0.23.2').run({}, NOW);
    assert.equal(r.notify?.version, 'v0.24.0');
  });
});
