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

  text(id: StringId): string {
    return this.texts[id];
  }

  get size(): number {
    return this.texts.length;
  }
}
