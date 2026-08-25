import { strict as assert } from 'assert';
import {
  SHOW_STRING_REFERENCES_COMMAND, ShowStringReferencesArgs,
  lensTitle, referencesLinkMarkdown,
} from '../../../src/presentation/string-references-link';

const ARGS: ShowStringReferencesArgs = {
  uri: 'file:///m/local/ubattend/lang/en/local_ubattend.php', line: 3, character: 9,
  component: 'local_ubattend', key: 'attendance_book',
};

describe('lensTitle — CodeLens 버튼 라벨', () => {
  it('색인 전(null) → 개수 없이 "사용 찾기"', () => assert.equal(lensTitle(null), '사용 찾기'));
  it('색인 후 → "사용 N건"', () => assert.equal(lensTitle(3), '사용 3건'));
  it('0건도 숫자로 — 침묵하면 색인이 안 된 것과 구별되지 않는다', () => assert.equal(lensTitle(0), '사용 0건'));
});

describe('referencesLinkMarkdown — hover 아래 명령 링크', () => {
  it('색인 후: "사용 N건 보기" 링크', () => {
    const md = referencesLinkMarkdown(ARGS, 2);
    assert.ok(md.startsWith(`[사용 2건 보기](command:${SHOW_STRING_REFERENCES_COMMAND}?`), md);
  });
  it('색인 전: "사용 찾기" 링크', () => {
    assert.ok(referencesLinkMarkdown(ARGS, null).startsWith('[사용 찾기](command:'));
  });
  it('인자가 명령 URI 쿼리에 JSON 배열로 인코딩되어 왕복한다', () => {
    const md = referencesLinkMarkdown(ARGS, 2);
    const query = md.slice(md.indexOf('?') + 1, -1);
    assert.deepEqual(JSON.parse(decodeURIComponent(query)), [ARGS]);
  });
});
