import { strict as assert } from 'assert';
import { join, resolve } from 'path';
import { parseEventDeclaration } from '../../../src/infrastructure/events/event-declaration-parser';
import { componentOfEventFile } from '../../../src/infrastructure/workspace/moodle-root-resolver';

const EVENT = `<?php
namespace local_x\\event;

/**
 * class doc
 */
class thing_created extends \\core\\event\\base {
    protected function init() {
        $this->data['crud'] = 'c';
        $this->data['edulevel'] = self::LEVEL_OTHER;
    }

    public static function get_name() {
        return get_string('eventthingcreated', 'local_x');
    }
}
`;

describe('parseEventDeclaration', () => {
  it('네임스페이스·클래스·crud·get_name()의 get_string', () =>
    assert.deepEqual(parseEventDeclaration(EVENT), {
      namespace: 'local_x\\event', shortName: 'thing_created', crud: 'c',
      title: { key: 'eventthingcreated', component: 'local_x' }, line: 6, column: 6,
    }));

  it('get_string 컴포넌트를 생략하면 core, 리터럴 반환은 그대로 이름', () => {
    assert.deepEqual(parseEventDeclaration(EVENT.replace(", 'local_x'", ''))?.title, { key: 'eventthingcreated', component: 'core' });
    assert.deepEqual(parseEventDeclaration(EVENT.replace(/return get_string\([^;]*;/, "return 'IP 추가';"))?.title, { text: 'IP 추가' });
    assert.deepEqual(parseEventDeclaration(EVENT.replace("'local_x'", 'manager::PLUGINNAME'))?.title, { key: 'eventthingcreated', component: null });
  });

  it('get_name()·crud를 물려받으면 비워 둔다', () => {
    const d = parseEventDeclaration("<?php\nnamespace local_x\\event;\nclass sub extends thing_created {\n}\n");
    assert.deepEqual(d && { crud: d.crud, title: d.title }, { crud: '', title: null });
  });

  it('추상 클래스와 아무것도 상속하지 않는 클래스(observer 등)는 이벤트가 아니다', () => {
    assert.equal(parseEventDeclaration(EVENT.replace('class thing_created', 'abstract class thing_created')), null);
    assert.equal(parseEventDeclaration('<?php\nnamespace local_x\\event;\nclass observer {\n}\n'), null);
  });
});

describe('componentOfEventFile', () => {
  const root = resolve(__dirname, '../../fixtures/mini-moodle');
  it('플러그인·코어의 classes/event 바로 아래 파일만', () => {
    assert.equal(componentOfEventFile(root, join(root, 'local/ubattend/classes/event/x_done.php')), 'local_ubattend');
    assert.equal(componentOfEventFile(root, join(root, 'lib/classes/event/course_viewed.php')), 'core');
    assert.equal(componentOfEventFile(root, join(root, 'local/ubattend/classes/event/sub/x.php')), null);
    assert.equal(componentOfEventFile(root, join(root, 'local/ubattend/classes/x.php')), null);
  });
});
