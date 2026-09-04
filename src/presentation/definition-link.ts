import { DefinitionResult, RangeItem } from '../application/dto';

export interface LinkRange { startLine: number; startColumn: number; endLine: number; endColumn: number; }

const spanOf = (r: RangeItem): LinkRange =>
  ({ startLine: r.line, startColumn: r.column0, endLine: r.line, endColumn: r.column0 + r.length });

export interface DefinitionLinkRanges {
  /** 소스에서 링크로 칠할 구간. 없으면 VS Code가 커서 위치의 단어 범위로 정한다. */
  origin?: LinkRange;
  /** 이동해 놓일 자리. 폭 0 — 이 확장이 정의 이동에서 늘 가리켜 온 지점 그대로다. */
  target: LinkRange;
}

export function definitionLinkRanges(result: DefinitionResult): DefinitionLinkRanges {
  const { line, column } = result.location;
  return {
    origin: result.origin && spanOf(result.origin),
    target: { startLine: line, startColumn: column, endLine: line, endColumn: column },
  };
}
