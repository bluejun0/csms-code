import { strict as assert } from 'assert';
import { configKeyCompletionPlugin } from '../../../src/presentation/config-call-prefix';

describe('configKeyCompletionPlugin — get_config 키 완성 문맥', () => {
  it("get_config('p', ' 뒤에서 입력 중 → p", () =>
    assert.equal(configKeyCompletionPlugin("$a = get_config('local_ubattend', 'api"), 'local_ubattend'));
  it('플러그인 인자 위치 → null', () => assert.equal(configKeyCompletionPlugin("get_config('local_"), null));
  it("''·moodle은 core", () => assert.equal(configKeyCompletionPlugin("get_config('moodle', '"), 'core'));
  it('다른 함수 → null', () => assert.equal(configKeyCompletionPlugin("get_string('k', '"), null));
});
