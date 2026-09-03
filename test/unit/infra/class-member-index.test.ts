import { strict as assert } from 'assert';
import { join } from 'path';
import * as fs from 'fs';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/php/php-syntax';
import { ClassMemberIndex } from '../../../src/infrastructure/coreapi/class-member-index';

const root = join(__dirname, '../../fixtures/mini-moodle');

describe('ClassMemberIndex', () => {
  let idx: ClassMemberIndex;
  before(async () => {
    const syn = await TreeSitterPhpSyntax.create();
    idx = new ClassMemberIndex();
    await idx.buildFromRoot(root, syn);
  });

  it('public 메서드와 프로퍼티를 담는다', () => {
    const names = idx.membersOf('moodle_database').map(m => m.name).sort();
    assert.deepEqual(names, ['get_record', 'prefix', 'update_record']);
  });

  it('private·protected는 제외한다', () => {
    const names = idx.membersOf('moodle_database').map(m => m.name);
    assert.ok(!names.includes('secret'), 'private 메서드');
    assert.ok(!names.includes('counter'), 'private 프로퍼티');
    assert.ok(!names.includes('internal_helper'), 'protected 메서드');
  });

  it('magic_get_x는 프로퍼티 x가 된다', () => {
    const ctx = idx.membersOf('moodle_page').find(m => m.name === 'context');
    assert.ok(ctx, 'context 프로퍼티가 있어야 한다');
    assert.equal(ctx!.kind, 'property');
    assert.equal(ctx!.doc, '페이지 컨텍스트');
  });

  it('시그니처와 phpdoc 첫 문장을 담는다', () => {
    const m = idx.membersOf('moodle_database').find(x => x.name === 'get_record')!;
    assert.equal(m.kind, 'method');
    assert.match(m.signature, /\$table/);
    assert.equal(m.doc, '레코드 하나를 가져온다.');
  });

  it('@var 접두는 설명에서 떼어낸다', () => {
    const p = idx.membersOf('moodle_database').find(x => x.name === 'prefix')!;
    assert.equal(p.kind, 'property');
    assert.equal(p.doc, '테이블 접두사');
  });

  it('위치가 선언 줄을 가리킨다', () => {
    const m = idx.membersOf('moodle_database').find(x => x.name === 'get_record')!;
    const line = fs.readFileSync(m.location.uri, 'utf8').split('\n')[m.location.line];
    assert.match(line, /function get_record/);
  });

  it('첫 후보에 클래스가 없으면 다음 후보로 넘어간다', () => {
    const members = idx.membersOf('core_renderer');
    assert.ok(members.length > 0, '두 번째 후보에서 찾아야 한다');
    assert.ok(members[0].location.uri.endsWith('outputrenderers.php'), members[0].location.uri);
  });

  it('없는 클래스는 빈 목록', () => assert.deepEqual(idx.membersOf('nope'), []));
});
