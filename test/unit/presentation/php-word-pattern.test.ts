import { strict as assert } from 'assert';
import { phpWordPattern } from '../../../src/presentation/php-word-pattern';

const words = (text: string) => text.match(phpWordPattern()) ?? [];

describe('PHP 단어 판정', () => {
  it('$ 접두가 변수와 한 단어다', () => {
    assert.deepEqual(words('$config'), ['$config']);
    assert.deepEqual(words('  $config;'), ['$config']);
  });

  it('프로퍼티 접근은 갈린다', () => {
    assert.deepEqual(words('$config->courseid'), ['$config', 'courseid']);
    assert.deepEqual(words('$this->db->get_record'), ['$this', 'db', 'get_record']);
  });

  it('호출·배열 구두점에서 갈린다', () => {
    assert.deepEqual(words("$DB->get_record('user', ['id' => 1])"),
      ['$DB', 'get_record', 'user', 'id', '1']);
  });

  it('문자열 보간 안의 변수도 한 단어다', () => {
    assert.deepEqual(words('"prefix {$id} suffix"'), ['prefix', '$id', 'suffix']);
  });

  it('숫자 리터럴은 기본 규칙을 유지한다', () => {
    assert.deepEqual(words('1.5'), ['1.5']);
  });
});
