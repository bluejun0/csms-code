import * as fs from 'fs';
import * as path from 'path';
import { ClassMember, ClassMemberRepository } from '../../domain/moodle-model/ports/class-member-repository';
import { PhpSyntax } from '../../domain/code-analysis/ports/php-syntax';

/** 전역이 가리키는 코어 클래스가 선언된 파일 후보. 버전마다 위치가 달라(core_renderer는 4.5에서
 *  lib/classes/output으로 옮겨졌고 옛 파일은 껍데기만 남았다) 선언이 실제로 있는 첫 후보를 쓴다. */
const CLASS_FILES: Record<string, string[]> = {
  moodle_database: ['lib/dml/moodle_database.php'],
  moodle_page: ['lib/pagelib.php'],
  core_renderer: ['lib/classes/output/core_renderer.php', 'lib/outputrenderers.php'],
};

/** 코어 클래스의 public 멤버 색인. 대상 파일이 크고(수십~수백 KB) 편집 대상도 아니므로
 *  활성화가 아니라 첫 요청에서 한 번만 만든다. */
export class ClassMemberIndex implements ClassMemberRepository {
  private byClass = new Map<string, ClassMember[]>();
  private builtFlag = false;

  get isBuilt(): boolean { return this.builtFlag; }

  async buildFromRoot(root: string, syntax: PhpSyntax): Promise<void> {
    const map = new Map<string, ClassMember[]>();
    for (const [className, candidates] of Object.entries(CLASS_FILES)) {
      map.set(className, await readClass(root, className, candidates, syntax));
    }
    this.byClass = map;
    this.builtFlag = true;
  }

  membersOf(className: string): ClassMember[] {
    return this.byClass.get(className) ?? [];
  }
}

async function readClass(root: string, className: string, candidates: string[],
                         syntax: PhpSyntax): Promise<ClassMember[]> {
  const declared = new RegExp(`(class|interface|trait)\\s+${className}\\b`);
  for (const rel of candidates) {
    const file = path.join(root, rel);
    let text: string;
    try { text = await fs.promises.readFile(file, 'utf8'); } catch { continue; }
    if (!declared.test(text)) continue;   // 선언이 없는 껍데기 파일은 다음 후보로
    return syntax.classMembers(text, className)
      .map(m => ({
        name: m.name, kind: m.kind, signature: m.signature, doc: m.doc,
        location: { uri: file, line: m.line, column: m.column },
      }));
  }
  return [];
}
