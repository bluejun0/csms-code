/** lang 파일 최상위의 `$string['key'] = …;` 문장 하나. 줄은 0-based. */
export interface LangStatement {
  key: string;
  firstLine: number;
  lastLine: number;
  /** 다른 문장과 줄을 나눠 쓴다 — 줄 단위로 떼어 옮길 수 없다. */
  sharesLine: boolean;
  /** 바로 앞 주석에 "deprecated"가 들어 있다. Moodle은 폐기 문자열을 파일 끝에 따로 모은다. */
  followsDeprecatedMarker: boolean;
}

export interface LangLayout {
  statements: LangStatement[];
  hasSyntaxError: boolean;
}

export interface LangLayoutReader {
  langLayout(text: string): LangLayout | null;
}
