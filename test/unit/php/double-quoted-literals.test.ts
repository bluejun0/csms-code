import { strict as assert } from 'assert';
import { TreeSitterPhpSyntax } from '../../../src/infrastructure/php/php-syntax';

/** PHP에서 보간이 없는 겹따옴표는 단일 인용과 같은 값을 만든다. 파서만 다른 노드로 볼 뿐이다. */
describe('보간 없는 겹따옴표도 리터럴이다', () => {
  let syntax: TreeSitterPhpSyntax;
  before(async () => { syntax = await TreeSitterPhpSyntax.create(); });

  const facts = (php: string) => syntax.facts(`<?php\n${php}\n`);

  it('템플릿 참조', () => {
    assert.deepEqual(facts('$O->render_from_template("local_x/card", $d);').templateCalls.map(c => c.ref),
      ['local_x/card']);
  });

  it('AMD 모듈 참조', () => {
    assert.deepEqual(facts('$P->requires->js_call_amd("local_x/view", "init");').amdCalls.map(c => c.ref),
      ['local_x/view']);
  });

  it('언어 문자열 — 키와 컴포넌트 각각', () => {
    const calls = facts('echo get_string("hello", "local_x");').stringCalls;
    assert.deepEqual(calls.map(c => `${c.key}@${c.component}`), ['hello@local_x']);
  });

  it('설정 키', () => {
    assert.deepEqual(facts('$v = get_config("local_x", "apikey");').configCalls.map(c => `${c.plugin}/${c.key}`),
      ['local_x/apikey']);
  });

  it('$DB 메서드의 테이블 인자', () => {
    assert.deepEqual(facts('$DB->get_record("user_ubion", ["id" => 1]);').tableRefs.map(r => r.name),
      ['user_ubion']);
  });

  it('레코드 타입 추론의 테이블 인자', () => {
    assert.deepEqual(facts('$rec = $DB->get_record("user_ubion", ["id" => 1]);').assignments.map(a => a.tableArg),
      ['user_ubion']);
  });

  it('컴포넌트 전파에 쓰이는 리터럴 대입·프로퍼티·상수', () => {
    const f = facts([
      '$plugin = "local_x";',
      'class C { public $component = "local_y"; const COMPONENT = "local_z"; }',
    ].join('\n'));
    assert.deepEqual(f.literalAssignments.map(a => a.value), ['local_x']);
    assert.deepEqual(f.propertyLiterals.map(p => p.value), ['local_y']);
    assert.deepEqual(f.constLiterals.map(c => c.value), ['local_z']);
  });

  it('두 인용 형태가 같은 파일에 섞여도 둘 다 잡는다', () => {
    assert.deepEqual(facts([
      '$O->render_from_template(\'local_x/single\', $d);',
      '$O->render_from_template("local_x/double", $d);',
    ].join('\n')).templateCalls.map(c => c.ref), ['local_x/single', 'local_x/double']);
  });
});

describe('리터럴이 아닌 겹따옴표는 침묵한다', () => {
  let syntax: TreeSitterPhpSyntax;
  before(async () => { syntax = await TreeSitterPhpSyntax.create(); });

  const refs = (php: string) => syntax.facts(`<?php\n${php}\n`).templateCalls.map(c => c.ref);

  it('보간이 있으면 조각을 참조로 오인하지 않는다', () => {
    assert.deepEqual(refs('$O->render_from_template("local_{$type}/card", $d);'), []);
  });

  it('변수를 이어붙인 보간도 마찬가지다', () => {
    assert.deepEqual(refs('$O->render_from_template("$plugin/card", $d);'), []);
  });

  it('이스케이프가 섞이면 침묵한다', () => {
    assert.deepEqual(refs('$O->render_from_template("local_x/card\\n", $d);'), []);
  });

  it('빈 문자열은 참조가 아니다', () => {
    assert.deepEqual(refs('$O->render_from_template("", $d);'), []);
  });
});
