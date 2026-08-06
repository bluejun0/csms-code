import { strict as assert } from 'assert';
import { join } from 'path';
import { AmdIndex } from '../../../src/infrastructure/amd/amd-index';
import { listAmdFiles } from '../../../src/infrastructure/workspace/moodle-root-resolver';
import { parseModuleRef } from '../../../src/domain/shared/module-ref';

const root = join(__dirname, '../../fixtures/mini-moodle');
const dump = (i: AmdIndex) => listAmdFiles(root)
  .map(r => `${r.component}/${r.name}:${i.locationsOf(r.component, r.name).map(l => l.uri).join(',')}`).sort();

describe('AmdIndex', () => {
  it('component/name으로 모듈 위치를 준다(중첩 경로 포함)', () => {
    const idx = new AmdIndex(); idx.buildFromRoot(root);
    assert.ok(idx.has('local_ubattend', 'setting'));
    assert.ok(idx.has('local_ubattend', 'sub/nested'));
    assert.ok(idx.has('core_form', 'submit'));
    assert.ok(idx.locationsOf('local_ubattend', 'setting')[0].uri.endsWith(join('amd', 'src', 'setting.js')));
    assert.equal(idx.has('local_ubattend', 'nope'), false);
  });

  it('동기 ≡ 비동기', async () => {
    const s = new AmdIndex(); s.buildFromRoot(root);
    const a = new AmdIndex(); await a.buildFromRootAsync(root);
    assert.deepEqual(dump(a), dump(s));
  });

  it('진행률 콜백은 완료 시점에 최소 1회', async () => {
    const calls: [number, number][] = [];
    const a = new AmdIndex();
    await a.buildFromRootAsync(root, (done, total) => calls.push([done, total]));
    assert.ok(calls.length >= 1);
    const [done, total] = calls[calls.length - 1];
    assert.equal(done, total);
  });

  it('증분이 전체 재빌드와 수렴한다', () => {
    const inc = new AmdIndex(); inc.buildFromRoot(root);
    const ref = listAmdFiles(root)[0];
    inc.removeFile(ref.file);
    assert.equal(inc.locationsOf(ref.component, ref.name).length, 0);
    inc.updateFile(ref.file, ref.component, ref.name);
    const full = new AmdIndex(); full.buildFromRoot(root);
    assert.deepEqual(dump(inc), dump(full));
  });

  // 위 dump는 파일시스템을 열거하므로 색인에만 남은 잔여 키를 볼 수 없다 — 옛 키 정리는 직접 확인한다.
  it('다른 키에 등록됐던 파일은 재등록 시 옛 키에서 사라진다', () => {
    const idx = new AmdIndex(); idx.buildFromRoot(root);
    const ref = listAmdFiles(root)[0];
    idx.updateFile(ref.file, 'wrong_comp', ref.name);
    assert.equal(idx.locationsOf('wrong_comp', ref.name).length, 1);
    idx.updateFile(ref.file, ref.component, ref.name);
    assert.equal(idx.locationsOf('wrong_comp', ref.name).length, 0, '옛 키에 잔여');
    assert.equal(idx.locationsOf(ref.component, ref.name).length, 1);
  });

  it('이미 등록된 파일의 updateFile은 아무것도 바꾸지 않는다', () => {
    const idx = new AmdIndex(); idx.buildFromRoot(root);
    const ref = listAmdFiles(root)[0];
    const before = idx.locationsOf(ref.component, ref.name).map(l => l.uri);
    idx.updateFile(ref.file, ref.component, ref.name);
    assert.deepEqual(idx.locationsOf(ref.component, ref.name).map(l => l.uri), before);
  });
});

describe('parseModuleRef', () => {
  it('component/name 분해, name은 하위 경로 허용', () => {
    assert.deepEqual(parseModuleRef('local_x/a/b'), { component: 'local_x', name: 'a/b' });
  });
  it('슬래시 없음·앞뒤 슬래시는 null', () => {
    assert.equal(parseModuleRef('bare'), null);
    assert.equal(parseModuleRef('/x'), null);
    assert.equal(parseModuleRef('x/'), null);
  });
});
