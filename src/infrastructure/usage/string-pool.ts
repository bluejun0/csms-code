export type StringId = number;

export class StringPool {
  private readonly ids = new Map<string, StringId>();
  private readonly texts: string[] = [];

  // 정규식 캡처는 원본 문자열을 가리키는 조각이라, 사본을 만들지 않고 보관하면 파일 전체가 살아남는다.
  // 사본은 Map의 키로도 써야 한다 — 조각을 키로 넣으면 풀이 그 조각을 통해 파일을 붙잡는다.
  id(value: string): StringId {
    const known = this.ids.get(value);
    if (known !== undefined) return known;
    const owned = Buffer.from(value, 'utf8').toString('utf8');
    const id = this.texts.length;
    this.texts.push(owned);
    this.ids.set(owned, id);
    return id;
  }

  find(value: string): StringId | undefined {
    return this.ids.get(value);
  }

  // 발급된 적 없는 id는 undefined를 조용히 돌려주지 않는다 — 그런 값이 SourceLocation.uri에
  // undefined로 섞여 들어가면 "정의로 이동" 같은 결과가 그대로 침묵 속에 깨진다.
  text(id: StringId): string {
    const value = this.texts[id];
    if (value === undefined) throw new Error(`문자열 풀에 없는 id: ${id}`);
    return value;
  }

  get size(): number {
    return this.texts.length;
  }
}
