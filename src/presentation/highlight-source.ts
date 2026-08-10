import { RangeItem } from '../application/dto';

/** 하이라이트 범위 공급자 — 대상 언어, 설정 키(csmscode 하위), 범위 계산을 함께 넘긴다.
 *  `.mustache`의 languageId는 사용자가 깐 확장에 따라 달라 신뢰할 수 없으므로 경로 접미사로도 고를 수 있다. */
export interface HighlightSource {
  setting: string; languages: string[]; pathSuffix?: string;
  run(text: string): RangeItem[];
}

export function sourceApplies(s: HighlightSource, languageId: string, fsPath: string): boolean {
  return s.languages.includes(languageId) || (s.pathSuffix !== undefined && fsPath.endsWith(s.pathSuffix));
}
