import * as path from 'path';
import { StringId, StringPool } from './string-pool';
import { UsageExtract, emptyExtract } from './usage-entries';
import { normalizeComponent } from '../../domain/lang-model/services/component-normalizer';
import { STRING_FUNCTION_ALTERNATION, STRING_CLASS_ALTERNATION, stringFunctionForm, stringClassForm, effectiveComponent } from '../../domain/code-analysis/string-functions';
import { configKeyId } from '../../domain/moodle-model/services/config-plugin';
import { scanJsCalls } from '../../domain/code-analysis/js-call-scanner';
import { scanMustache } from '../../domain/code-analysis/mustache-scanner';

// 리터럴 key + (닫힘 | 리터럴 component). 컴포넌트가 변수·보간이면 통째로 비매칭 — 기본 컴포넌트로 오귀속하지 않는다(침묵 원칙).
// 1=함수 이름 2=클래스 이름(`new` 꼴) 3=key 4=component(생략이면 undefined)
const USAGE_RE = new RegExp(String.raw`(?:\b(${STRING_FUNCTION_ALTERNATION})|new\s+\\?(${STRING_CLASS_ALTERNATION}))\(\s*['"]([\w:./-]+)['"]\s*(?:\)|,\s*['"](\w*)['"])`, 'g');
// 템플릿 사용처 — 같은 스캔에서 함께 수집한다(23초 스캔을 두 번 돌리지 않기 위해)
const TEMPLATE_USAGE_RE = /render_from_template\(\s*['"]([\w:./-]+)['"]/g;
// AMD 모듈 사용처 — 같은 스캔에서 함께 수집한다
const AMD_USAGE_RE = /js_call_amd\(\s*['"]([\w:./-]+)['"]/g;
// 설정 사용처 — get_config(plugin, key) / set_config(key, value, plugin). 값에 괄호가 있으면 어디서 끝나는지 정규식으로 알 수 없어 비매칭.
// `->get_config(…)`·`::get_config(…)`는 다른 의미의 메서드라 제외한다(팩트도 함수 호출만 본다).
const CONFIG_GET_RE = /(?<![>\w$:])get_config\(\s*['"](\w+)['"]\s*,\s*['"](\w+)['"]\s*\)/g;
const CONFIG_SET_RE = /(?<![>\w$:])set_config\(\s*['"](\w+)['"]\s*,\s*[^;()]*?,\s*['"](\w+)['"]\s*\)/g;
// 테이블 사용처 — SQL 문자열의 `{name}`과 `$DB->메서드('name', …)`. `sql_` 계열은 첫 인자가 컬럼·식이라 제외한다.
// 실재 테이블인지는 걸러내지 않는다 — 조회는 색인된 이름으로만 하고, 걸러 두면 install.xml에
// 테이블을 새로 추가했을 때 그 테이블이 "사용 0건"으로 보인다.
const TABLE_BRACE_RE = /\{([a-z][a-z0-9_]*)\}/g;
const TABLE_DML_RE = /\$DB->([a-z_]\w*)\(\s*['"]([a-z][a-z0-9_]*)['"]/g;
// 'lang'은 lang 팩 자체 — 사용처가 아니고, 값 텍스트 속 "get_string(" 유령 매치 방지를 겸한다
export const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', '.superpowers', 'dist', 'lang']);

/** 추출이 필요로 하는 최소 협력자 — 풀·이 파일의 id·canonical 존재 판정만 있으면 된다. */
export interface ExtractContext {
  pool: StringPool;
  file: StringId;
  hasCanonical: (component: string) => boolean;
}

/** 확장자로 PHP·JS·mustache 추출기를 고른다. */
export function extractUsages(uri: string, text: string, ctx: ExtractContext): UsageExtract {
  if (uri.endsWith('.js')) return extractJs(text, ctx);
  if (uri.endsWith('.mustache')) return extractMustache(text, ctx);
  return extractPhp(text, ctx);
}

function extractPhp(text: string, ctx: ExtractContext): UsageExtract {
  const out = emptyExtract();
  // 키 리터럴 내용 시작 = 매치 안 첫 따옴표 다음
  const firstLiteralColumn = (m: RegExpExecArray, lineStart: number) => m.index - lineStart + m[0].search(/['"]/) + 1;
  forEachMatch(text, USAGE_RE, (m, line, lineStart) => {
    const form = m[1] ? stringFunctionForm(m[1]) : stringClassForm(m[2]);
    if (!form) return;
    const component = normalizeComponent(effectiveComponent(form, m[4] ?? ''), ctx.hasCanonical);
    out.strings.push({
      component: ctx.pool.id(component),
      key: ctx.pool.id(m[3]),
      file: ctx.file,
      line,
      column: firstLiteralColumn(m, lineStart),
    });
  });
  forEachMatch(text, TEMPLATE_USAGE_RE, (m, line, lineStart) => {
    out.templates.push({ ref: ctx.pool.id(m[1]), file: ctx.file, line, column: firstLiteralColumn(m, lineStart) });
  });
  forEachMatch(text, AMD_USAGE_RE, (m, line, lineStart) => {
    out.amd.push({ ref: ctx.pool.id(m[1]), file: ctx.file, line, column: firstLiteralColumn(m, lineStart) });
  });
  forEachMatch(text, CONFIG_GET_RE, (m, line, lineStart) => {
    const keyOffset = m[0].indexOf(m[2], m[0].indexOf(',')); // 둘째 리터럴의 내용 시작
    out.config.push({ id: ctx.pool.id(configKeyId(m[1], m[2])), file: ctx.file, line, column: m.index - lineStart + keyOffset });
  });
  forEachMatch(text, CONFIG_SET_RE, (m, line, lineStart) => {
    out.config.push({ id: ctx.pool.id(configKeyId(m[2], m[1])), file: ctx.file, line, column: firstLiteralColumn(m, lineStart) });
  });
  forEachMatch(text, TABLE_BRACE_RE, (m, line, lineStart) => {
    out.tables.push({ name: ctx.pool.id(m[1]), file: ctx.file, line, column: m.index - lineStart + 1 }); // `{` 다음이 이름 시작
  });
  forEachMatch(text, TABLE_DML_RE, (m, line, lineStart) => {
    if (m[1].startsWith('sql_')) return;
    out.tables.push({ name: ctx.pool.id(m[2]), file: ctx.file, line, column: firstLiteralColumn(m, lineStart) });
  });
  return out;
}

/** mustache의 `{{> }}`·`{{< }}`는 템플릿 사용처, `{{#str}}`는 문자열 사용처다.
 *  component는 PHP 경로와 같은 정규화를 거쳐야 lang 쪽 참조 목록에서 갈리지 않는다. */
function extractMustache(text: string, ctx: ExtractContext): UsageExtract {
  const refs = scanMustache(text);
  const out = emptyExtract();
  for (const r of refs.stringRefs) {
    out.strings.push({
      component: ctx.pool.id(normalizeComponent(r.component, ctx.hasCanonical)),
      key: ctx.pool.id(r.key),
      file: ctx.file,
      line: r.keyLine,
      column: r.keyColumn,
    });
  }
  for (const r of refs.templateRefs) {
    out.templates.push({ ref: ctx.pool.id(r.ref), file: ctx.file, line: r.line, column: r.column });
  }
  return out;
}

/** JS에는 js_call_amd가 없다(모듈 로딩은 import·require) — amd는 항상 비어 있다. */
function extractJs(text: string, ctx: ExtractContext): UsageExtract {
  const calls = scanJsCalls(text);
  const out = emptyExtract();
  for (const c of calls.stringCalls) {
    out.strings.push({
      component: ctx.pool.id(normalizeComponent(c.component, ctx.hasCanonical)),
      key: ctx.pool.id(c.key),
      file: ctx.file,
      line: c.keyLine,
      column: c.keyColumn,
    });
  }
  for (const c of calls.templateCalls) {
    out.templates.push({ ref: ctx.pool.id(c.ref), file: ctx.file, line: c.refLine, column: c.refColumn });
  }
  return out;
}

/** 매치마다 (줄, 줄 시작 오프셋)을 누적해서 준다 — 매치마다 앞을 되짚으면 매치 수에 제곱이 된다. */
function forEachMatch(text: string, re: RegExp, fn: (m: RegExpExecArray, line: number, lineStart: number) => void): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  let lastIdx = 0, line = 0, lineStart = 0;
  while ((m = re.exec(text))) {
    for (let i = lastIdx; i < m.index; i++) if (text.charCodeAt(i) === 10) { line++; lineStart = i + 1; }
    lastIdx = m.index;
    fn(m, line, lineStart);
  }
}

/** 콜드 스캔과 저장 증분이 같은 제외 규칙을 쓰게 하는 단일 술어.
 *  amd/build는 amd/src의 미니파이 사본이라 색인하면 참조가 중복되고 생성 파일로 점프한다. */
export function isIndexableSourcePath(root: string, fsPath: string): boolean {
  if (!fsPath.endsWith('.php') && !fsPath.endsWith('.js') && !fsPath.endsWith('.mustache')) return false;
  if (fsPath.endsWith('.min.js')) return false;
  const rel = path.relative(root, fsPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const segs = rel.split(path.sep);
  if (segs.some(seg => SKIP_DIRS.has(seg))) return false;
  return !segs.some((seg, i) => seg === 'build' && segs[i - 1] === 'amd');
}
