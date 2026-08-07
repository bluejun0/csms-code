/** 출처 표시 문자열 조립 — vscode 없이 테스트할 수 있게 분리한다. */
export const SOURCE_LABEL = 'csms-intelli';

export interface LabelParts { label: string; detail?: string; description?: string; }

/** 완성 항목 라벨. description은 행 끝에 흐리게 렌더링되고 필터링에는 쓰이지 않는다. */
export function completionLabelParts(label: string, detail: string | undefined, enabled: boolean): LabelParts {
  if (!enabled) return { label, detail: detail ? ` ${detail}` : undefined };
  return { label, detail: detail ? ` ${detail}` : undefined, description: SOURCE_LABEL };
}

/** hover 본문 아래 출처 한 줄. */
export function hoverMarkdownWithSource(markdown: string, enabled: boolean): string {
  return enabled ? `${markdown}\n\n\`${SOURCE_LABEL}\`` : markdown;
}
