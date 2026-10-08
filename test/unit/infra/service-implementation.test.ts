import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ResolveServiceImplementation } from '../../../src/application/resolve-service-implementation';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/php/php-syntax';
import { ExternalImplementationFinder } from '../../../src/infrastructure/services/external-implementation-finder';
import { parseServiceImplementations } from '../../../src/infrastructure/services/services-declaration-parser';

describe('parseServiceImplementations', () => {
  it('classname·methodname 원문 구간과 classpath를 읽는다', () => {
    const text = `<?php
$functions = [
    'a' => [
        'classname' => 'local_x\\\\external\\\\foo',
        'methodname' => 'run',
        'classpath' => 'local/x/lib.php',
    ],
];`;
    assert.deepEqual(parseServiceImplementations(text), [{
      name: 'a', classname: 'local_x\\external\\foo', methodname: 'run', classpath: 'local/x/lib.php',
      classnameSpan: { line: 3, column0: 24, length: 22 },
      methodnameSpan: { line: 4, column0: 25, length: 3 },
    }]);
  });

  it('`::class` 값도 클래스명으로 읽는다', () => {
    const text = "<?php\n$functions = [\n  'b' => [\n    'classname' => \\tool_y\\external\\bar::class,\n  ],\n];";
    const [d] = parseServiceImplementations(text);
    assert.equal(d.classname, 'tool_y\\external\\bar');
    assert.deepEqual(d.classnameSpan, { line: 3, column0: 20, length: 19 });
    assert.equal(d.methodnameSpan, null);
  });

  it('리터럴이 아닌 값 뒤의 키를 값으로 오인하지 않는다', () => {
    const text = "<?php\n$functions = [\n  'c' => [\n    'ajax' => true, 'classname' => 'local_x_external', 'methodname' => 'go',\n  ],\n];";
    const [d] = parseServiceImplementations(text);
    assert.equal(d.classname, 'local_x_external');
    assert.equal(d.methodname, 'go');
  });
});

describe('ExternalImplementationFinder·ResolveServiceImplementation', () => {
  let root: string;
  let syntax: TreeSitterPhpSyntax;
  const write = (rel: string, text: string) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const lineOf = (rel: string, needle: string) =>
    fs.readFileSync(path.join(root, rel), 'utf8').split('\n').findIndex(l => l.includes(needle));

  before(async () => {
    syntax = await TreeSitterPhpSyntax.create();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'csms-services-'));
    write('version.php', '<?php');
    write('lib/components.json', JSON.stringify({ plugintypes: { local: 'local' }, subsystems: { course: 'course' } }));
    write('local/foo/classes/external/get_x.php',
      '<?php\nnamespace local_foo\\external;\n\nclass get_x {\n    public static function execute() {}\n}\n');
    write('local/foo/classes/external.php',
      '<?php\nclass local_foo_external {\n    public static function Run_Legacy() {}\n}\n');
    write('local/foo/externallib.php',
      '<?php\nclass local_foo_old_external {\n    public static function old() {}\n}\n');
    write('local/foo/classes/core/impl.php',
      '<?php\nnamespace local_foo\\core;\n\nclass impl {\n    public static function login() {}\n}\n');
    write('local/foo/classes/external/thin.php',
      '<?php\nnamespace local_foo\\external;\n\nuse local_foo\\core\\impl as Base;\n\nclass thin extends Base {\n}\n');
    write('course/externallib.php',
      '<?php\nif (!class_exists(\'core_course_external\')) {\nclass core_course_external {\n    public static function get_courses() {}\n}\n}\n');
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  const find = (classname: string, methodname: string, classpath = '', component = 'local_foo') =>
    new ExternalImplementationFinder(root, syntax).find({ component, classname, methodname, classpath });
  const at = (rel: string, needle: string, column: number) =>
    ({ uri: path.join(root, rel), line: lineOf(rel, needle), column });

  it('네임스페이스 클래스는 classes/ 아래 경로로', () =>
    assert.deepEqual(find('local_foo\\external\\get_x', 'execute'), {
      classAt: at('local/foo/classes/external/get_x.php', 'class get_x', 6),
      methodAt: at('local/foo/classes/external/get_x.php', 'function execute', 27),
    }));

  it('레거시 이름은 classes/<나머지>.php로, 대소문자는 가리지 않는다', () =>
    assert.deepEqual(find('local_foo_external', 'run_legacy')?.methodAt,
      at('local/foo/classes/external.php', 'function Run_Legacy', 27)));

  it('자동 로드로 못 찾으면 선언한 컴포넌트의 externallib.php', () =>
    assert.deepEqual(find('local_foo_old_external', 'old')?.methodAt, at('local/foo/externallib.php', 'function old', 27)));

  it('classpath가 있으면 그 파일 — 블록 안의 클래스 선언도 찾는다', () =>
    assert.deepEqual(find('core_course_external', 'get_courses', 'course/externallib.php', 'core')?.methodAt,
      at('course/externallib.php', 'function get_courses', 27)));

  it('메서드가 없으면 use 별칭으로 적은 부모 클래스에서 찾는다', () =>
    assert.deepEqual(find('\\local_foo\\external\\thin', 'login')?.methodAt,
      at('local/foo/classes/core/impl.php', 'function login', 27)));

  it('클래스는 있는데 메서드가 없으면 methodAt만 null, 클래스가 없으면 null', () => {
    assert.equal(find('local_foo\\external\\get_x', 'missing')?.methodAt, null);
    assert.equal(find('local_foo\\external\\nope', 'execute'), null);
  });

  describe('ResolveServiceImplementation', () => {
    const services = `<?php
$functions = [
    'local_foo_get_x' => [
        'classname' => 'local_foo\\\\external\\\\get_x',
        'description' => 'methodname 없음 → execute',
    ],
    'local_foo_broken' => [
        'classname' => 'local_foo\\\\external\\\\get_x',
        'methodname' => 'missing',
    ],
];`;
    const uc = () => new ResolveServiceImplementation({ implementationsIn: parseServiceImplementations },
      new ExternalImplementationFinder(root, syntax));

    it('찾은 값만 칠한다 — 없는 메서드는 칠하지 않는다', () =>
      assert.deepEqual(uc().resolvedRanges(services, 'local_foo'), [
        { line: 3, column0: 24, length: 26 },
        { line: 7, column0: 24, length: 26 },
      ]));

    it('classname 위에서 정의 이동 → 클래스, origin은 값 구간', () =>
      assert.deepEqual(uc().run(services, 'local_foo', 3, 30), [{
        location: at('local/foo/classes/external/get_x.php', 'class get_x', 6),
        origin: { line: 3, column0: 24, length: 26 },
      }]));

    it('트리 항목 → methodname이 없으면 execute 메서드', () =>
      assert.deepEqual(uc().locate(services, 'local_foo', 'local_foo_get_x'),
        at('local/foo/classes/external/get_x.php', 'function execute', 27)));
  });
});
