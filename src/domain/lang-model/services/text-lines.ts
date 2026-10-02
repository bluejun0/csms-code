import { LinePosition } from '../ports/lang-layout-reader';

/** VS Code 문서와 같은 줄 모델: `\r\n`·`\r`·`\n`이 줄을 끊고, 범위 밖 위치는 문서 끝으로 맞춘다. */
export class TextLines {
  private readonly starts: number[] = [0];
  private readonly lengths: number[] = [];
  readonly eol: string;

  constructor(readonly text: string) {
    const breaks = /\r\n|\r|\n/g;
    let m: RegExpExecArray | null;
    while ((m = breaks.exec(text))) {
      this.lengths.push(m.index - this.starts[this.starts.length - 1]);
      this.starts.push(m.index + m[0].length);
    }
    this.lengths.push(text.length - this.starts[this.starts.length - 1]);
    this.eol = text.includes('\r\n') ? '\r\n' : '\n';
  }

  get count(): number { return this.starts.length; }

  offsetAt(p: LinePosition): number {
    if (p.line >= this.count) return this.text.length;
    return this.starts[p.line] + Math.min(p.character, this.lengths[p.line]);
  }

  slice(range: { start: LinePosition; end: LinePosition }): string {
    return this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
  }

  lastNonEmptyLine(): number {
    let line = this.count - 1;
    while (line > 0 && this.text.substr(this.starts[line], this.lengths[line]).trim() === '') line--;
    return line;
  }
}
