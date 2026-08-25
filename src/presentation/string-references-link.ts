/** 사용처 버튼(CodeLens)·링크(hover)가 부르는 내부 명령과 그 라벨 — vscode 없이 테스트할 수 있게 분리한다. */
export const SHOW_STRING_REFERENCES_COMMAND = 'csmscode.showStringReferences';

/** 버튼·링크가 사용처 개수를 물을 곳 — 색인 전(built=false)에는 개수 없이 진입점만 보여 준다. */
export interface ReferenceCounter {
  built(): boolean;
  count(component: string, key: string): number;
}

/** 명령 인자. hover 링크는 URI 쿼리로 직렬화되므로 vscode 객체 대신 원시값만 담는다. */
export interface ShowStringReferencesArgs {
  uri: string; line: number; character: number;
  component: string; key: string;
}

/** CodeLens 라벨. 색인 전(null)에는 개수를 알 수 없으니 버튼만 보여 준다.
 *  0건도 숫자로 적는다 — 비우면 색인이 안 된 것과 구별되지 않는다. */
export function lensTitle(count: number | null): string {
  return count === null ? '사용처 보기' : `사용처 ${count}곳`;
}

export function referencesCommandUri(args: ShowStringReferencesArgs): string {
  return `command:${SHOW_STRING_REFERENCES_COMMAND}?${encodeURIComponent(JSON.stringify([args]))}`;
}

/** hover 본문 아래에 붙는 링크 한 줄. 렌더링에는 MarkdownString.isTrusted가 필요하다. */
export function referencesLinkMarkdown(args: ShowStringReferencesArgs, count: number | null): string {
  const text = count === null ? '사용처 보기' : `사용처 ${count}곳 보기`;
  return `[${text}](${referencesCommandUri(args)})`;
}
