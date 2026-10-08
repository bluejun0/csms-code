/** 파일에 선언된 클래스 하나 — 이름은 네임스페이스를 붙인 전체 이름(앞 `\` 없음), 위치는 이름 토큰. */
export interface ClassOutline {
  name: string;
  line: number;
  column: number;
  /** `extends`의 전체 이름(네임스페이스·`use` 반영). 없으면 null. */
  parent: string | null;
  methods: { name: string; line: number; column: number }[];
}

export interface ClassOutlineReader {
  classOutlines(text: string): ClassOutline[];
}
