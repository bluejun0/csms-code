import { SourceLocation } from '../../domain/shared/value-objects';
import { TemplateRepository } from '../../domain/template-model/ports/template-repository';
import { listTemplateFiles } from '../workspace/moodle-root-resolver';

/** `component/name` → 템플릿 파일 위치. 원본과 테마 오버라이드가 함께 잡히면 둘 다 보관한다. */
export class TemplateIndex implements TemplateRepository {
  private byRef = new Map<string, SourceLocation[]>();

  buildFromRoot(root: string): void {
    const map = new Map<string, SourceLocation[]>();
    for (const { file, component, name } of listTemplateFiles(root)) {
      const key = `${component}/${name}`;
      const arr = map.get(key) ?? [];
      arr.push({ uri: file, line: 0, column: 0 });
      map.set(key, arr);
    }
    this.byRef = map;
  }

  locationsOf(component: string, name: string): SourceLocation[] {
    return this.byRef.get(`${component}/${name}`) ?? [];
  }
  has(component: string, name: string): boolean { return this.byRef.has(`${component}/${name}`); }
}
