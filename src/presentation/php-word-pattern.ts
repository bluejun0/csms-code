/** PHP 단어 판정 — `$`를 단어 문자로 포함시켜 더블클릭·Ctrl+D가 `$config`를 통째로 잡게 한다.
 *  VS Code 기본 PHP 설정은 `$`를 구분자로 봐서 `config`만 선택된다.
 *  나머지 구분자(연산자·구두점·공백)는 기본과 같게 유지한다. */
export const PHP_WORD_PATTERN_SOURCE = "(-?\\d*\\.\\d\\w*)|([^`~!@#%^&*()\\-=+[{\\]}\\\\|;:'\",.<>\\/?\\s]+)";

export function phpWordPattern(): RegExp {
  return new RegExp(PHP_WORD_PATTERN_SOURCE, 'g');
}
