/** 0-based 줄과 그 줄 안의 UTF-16 오프셋. */
export interface LinePosition { line: number; character: number; }

/** lang 파일 최상위의 `$string['key'] = …;` 문장 하나. */
export interface LangStatement {
  key: string;
  keyLine: number;
  start: LinePosition;
  end: LinePosition;
  /** 뒤따르는 최상위 코드(주석 제외)의 시작 줄. 없으면 null. */
  nextCodeLine: number | null;
  /** 바로 앞 주석에 "deprecated"가 들어 있다. Moodle은 폐기 문자열을 파일 끝에 따로 모은다. */
  followsDeprecatedMarker: boolean;
}

export interface LangComment { line: number; block: boolean; }

/** 문법 오류가 있으면 세 항목 모두 비어 있다. */
export interface LangLayout {
  statements: LangStatement[];
  firstCodeLine: number | null;
  comments: LangComment[];
}

export interface LangLayoutReader {
  langLayout(text: string): LangLayout | null;
}
