import { strict as assert } from 'assert';
import { HighlightSource } from '../../../src/presentation/resolved-highlight';

/** registerResolvedHighlight가 문서 언어·설정으로 소스를 고르는 규칙을 순수 함수로 재현해 검증한다
 *  (vscode 결선 자체는 통합 테스트 몫 — 여기서는 라우팅 계약만 고정한다). */
function pick(sources: HighlightSource[], languageId: string, enabled: Record<string, boolean>): HighlightSource[] {
  return sources.filter(s => s.languages.includes(languageId)).filter(s => enabled[s.setting] !== false);
}

const S = 'strings.highlightResolved';
const T = 'templates.highlightResolved';
const sources: HighlightSource[] = [
  { setting: S, languages: ['php'], run: () => [] },
  { setting: T, languages: ['php'], run: () => [] },
  { setting: S, languages: ['javascript'], run: () => [] },
  { setting: T, languages: ['javascript'], run: () => [] },
];

describe('하이라이트 소스 라우팅', () => {
  it('php 문서는 php 소스 2개만', () => {
    const r = pick(sources, 'php', {});
    assert.equal(r.length, 2);
    assert.ok(r.every(s => s.languages.includes('php')));
  });
  it('javascript 문서는 js 소스 2개만', () => {
    const r = pick(sources, 'javascript', {});
    assert.equal(r.length, 2);
    assert.ok(r.every(s => s.languages.includes('javascript')));
  });
  it('무관한 언어는 0개', () => assert.equal(pick(sources, 'python', {}).length, 0));
  it('템플릿 설정만 끄면 JS에서도 문자열만 남는다', () => {
    const r = pick(sources, 'javascript', { [T]: false });
    assert.equal(r.length, 1);
    assert.equal(r[0].setting, S);
  });
  it('문자열 설정만 끄면 JS에서도 템플릿만 남는다', () => {
    const r = pick(sources, 'javascript', { [S]: false });
    assert.equal(r.length, 1);
    assert.equal(r[0].setting, T);
  });
  it('둘 다 끄면 0개', () =>
    assert.equal(pick(sources, 'javascript', { [S]: false, [T]: false }).length, 0));
});
