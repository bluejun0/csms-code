/** 사용처 버튼(CodeLens)·링크(hover)가 부르는 내부 명령과 그 라벨 — vscode 없이 테스트할 수 있게 분리한다. */
export const SHOW_STRING_REFERENCES_COMMAND = 'csmscode.showStringReferences';
export const SHOW_CONFIG_REFERENCES_COMMAND = 'csmscode.showConfigReferences';
export const SHOW_TEMPLATE_REFERENCES_COMMAND = 'csmscode.showTemplateReferences';
export const SHOW_AMD_REFERENCES_COMMAND = 'csmscode.showAmdReferences';
export const SHOW_TABLE_REFERENCES_COMMAND = 'csmscode.showTableReferences';

export type ReferenceKind = 'string' | 'config';

export function commandForKind(kind: ReferenceKind): string {
  return kind === 'config' ? SHOW_CONFIG_REFERENCES_COMMAND : SHOW_STRING_REFERENCES_COMMAND;
}

/** 버튼·링크가 사용처 개수를 물을 곳 — 색인 전(built=false)에는 개수 없이 진입점만 보여 준다. */
export interface ReferenceCounter {
  built(): boolean;
  count(component: string, key: string): number;
}
export type ReferenceCounters = Record<ReferenceKind, ReferenceCounter>;

/** 명령 인자. hover 링크는 URI 쿼리로 직렬화되므로 vscode 객체 대신 원시값만 담는다. 설정은 component 자리에 plugin. */
export interface ShowReferencesArgs {
  uri: string; line: number; character: number;
  component: string; key: string;
}

/** CodeLens 하나가 가리키는 대상 — 어느 줄에, 어떤 명령으로, 개수는 어떻게 세는가 */
export interface UsageLensTarget {
  line: number;
  command: string;
  args: ShowReferencesArgs;
  count(): number | null;
}

/** CodeLens 라벨. 색인 전(null)에는 개수를 알 수 없으니 버튼만 보여 준다.
 *  0건도 숫자로 적는다 — 비우면 색인이 안 된 것과 구별되지 않는다. */
export function lensTitle(count: number | null): string {
  return count === null ? '사용 찾기' : `사용 ${count}건`;
}

export function referencesCommandUri(command: string, args: ShowReferencesArgs): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify([args]))}`;
}

/** hover 본문 아래에 붙는 링크 한 줄. 렌더링에는 MarkdownString.isTrusted가 필요하다. */
export function referencesLinkMarkdown(command: string, args: ShowReferencesArgs, count: number | null): string {
  const text = count === null ? '사용 찾기' : `사용 ${count}건 보기`;
  return `[${text}](${referencesCommandUri(command, args)})`;
}
