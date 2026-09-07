/** 인용 형태를 가리지 않는 문자열 리터럴. PHP에서 보간 없는 겹따옴표는 단일 인용과 같은 값이지만
 *  파서는 다른 노드로 본다. 앞뒤 앵커가 string_content를 유일한 자식으로 묶어, 보간·이스케이프로
 *  조각난 문자열(`"local_{$t}/card"`)은 그 조각이 참조로 오인되지 않고 침묵한다. */
export const literalString = (capture: string): string =>
  `[(string (string_content) @${capture}) (encapsed_string . (string_content) @${capture} .)]`;
