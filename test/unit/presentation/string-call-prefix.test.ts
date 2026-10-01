import { strict as assert } from 'assert';
import { isStringKeyPrefix, stringKeyCompletionComponent } from '../../../src/presentation/string-call-prefix';

describe('isStringKeyPrefix — 키 완성 트리거 문맥', () => {
  it("get_string(' 뒤에서 입력 중 → true", () =>
    assert.equal(isStringKeyPrefix("echo get_string('att"), true));
  it("print_string(' 뒤에서 입력 중 → true", () =>
    assert.equal(isStringKeyPrefix("print_string(\""), true));
  it("new \\lang_string(' 뒤 → true", () =>
    assert.equal(isStringKeyPrefix("$s = new \\lang_string('"), true));
  it('컴포넌트 인자 위치 → false', () =>
    assert.equal(isStringKeyPrefix("get_string('k', 'loc"), false));
  it("->string_for_js(' 뒤 → true", () =>
    assert.equal(isStringKeyPrefix("$PAGE->requires->string_for_js('log"), true));
  it("->strings_for_js([' 뒤, 앞선 원소가 있어도 → true", () =>
    assert.equal(isStringKeyPrefix("$PAGE->requires->strings_for_js(['a', 'b"), true));
  it('다른 함수의 첫 인자 → false', () =>
    assert.equal(isStringKeyPrefix("render_from_template('x"), false));
});

describe('stringKeyCompletionComponent — 완성할 컴포넌트', () => {
  it('컴포넌트 리터럴이 뒤따르면 그것', () =>
    assert.equal(stringKeyCompletionComponent("echo get_string('att", "', 'local_ubattend')"), 'local_ubattend'));
  it('한 인자 꼴(바로 닫힘)이면 그 형태의 기본 — get_string은 core', () =>
    assert.equal(stringKeyCompletionComponent("echo get_string('o", "')"), 'core'));
  it('moodle_exception 한 인자 꼴 → error', () =>
    assert.equal(stringKeyCompletionComponent("throw new moodle_exception('", "')"), 'error'));
  it("print_error('k', 'moodle') → error", () =>
    assert.equal(stringKeyCompletionComponent("print_error('x", "', 'moodle')"), 'error'));
  it('string_for_js는 뒤따르는 컴포넌트', () =>
    assert.equal(stringKeyCompletionComponent("$PAGE->requires->string_for_js('log", "', 'core');"), 'core'));
  it('strings_for_js는 배열이 닫힌 뒤의 컴포넌트 — 여러 줄에 걸쳐도', () =>
    assert.equal(stringKeyCompletionComponent(
      "$PAGE->requires->strings_for_js([\n    'reason_menuname_member',\n    'r",
      "',\n    'other',\n], 'local_manager');"), 'local_manager'));
  it('strings_for_js의 array() 꼴', () =>
    assert.equal(stringKeyCompletionComponent("$PAGE->requires->strings_for_js(array('", "'), 'moodle');"), 'core'));
  it('strings_for_js 컴포넌트가 아직 없으면 null', () =>
    assert.equal(stringKeyCompletionComponent("$PAGE->requires->strings_for_js(['", "'"), null));
  it('여러 줄의 get_string도 컴포넌트를 읽는다', () =>
    assert.equal(stringKeyCompletionComponent("get_string(\n    'att", "',\n    'local_x')"), 'local_x'));
  it('컴포넌트도 닫힘도 없으면 null(아직 모른다)', () =>
    assert.equal(stringKeyCompletionComponent("echo get_string('att", ""), null));
  it('문자열 함수 문맥이 아니면 null', () =>
    assert.equal(stringKeyCompletionComponent("render_from_template('x", "')"), null));
});
