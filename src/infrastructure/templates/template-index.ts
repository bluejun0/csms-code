import { SourceLocation } from '../../domain/shared/value-objects';
import { TemplateRepository } from '../../domain/template-model/ports/template-repository';
import { listTemplateFiles, listTemplateFilesAsync, yieldNow, INDEX_YIELD_EVERY } from '../workspace/moodle-root-resolver';

type RefMap = Map<string, SourceLocation[]>;

/** `component/name` → 템플릿 파일 위치. 원본과 테마 오버라이드가 함께 잡히면 둘 다 보관한다. */
export class TemplateIndex implements TemplateRepository {
  private byRef: RefMap = new Map();

  buildFromRoot(root: string): void {
    const map: RefMap = new Map();
    for (const { file, component, name } of listTemplateFiles(root)) addRef(map, file, component, name);
    this.byRef = map;
  }

  /** 활성화 경로용 — 열거가 비동기이고 200항목마다 양보한다(템플릿은 내용을 읽지 않는다). */
  async buildFromRootAsync(root: string, onProgress?: (done: number, total: number) => void): Promise<void> {
    const refs = await listTemplateFilesAsync(root);
    const map: RefMap = new Map();
    let done = 0;
    for (const { file, component, name } of refs) {
      addRef(map, file, component, name);
      done++;
      if (done % INDEX_YIELD_EVERY === 0) { onProgress?.(done, refs.length); await yieldNow(); }
    }
    onProgress?.(refs.length, refs.length);
    this.byRef = map;
  }

  /** 템플릿 파일 하나가 바뀌면 그 위치만 교체 */
  updateFile(file: string, component: string, name: string): void {
    this.removeFile(file);
    addRef(this.byRef, file, component, name);
  }

  /** 해당 파일 위치만 제거 — 위치가 하나도 남지 않은 키는 지운다 */
  removeFile(uri: string): void {
    for (const [key, arr] of this.byRef) {
      const kept = arr.filter(l => l.uri !== uri);
      if (kept.length === arr.length) continue;
      if (kept.length === 0) this.byRef.delete(key); else this.byRef.set(key, kept);
    }
  }

  locationsOf(component: string, name: string): SourceLocation[] {
    return this.byRef.get(`${component}/${name}`) ?? [];
  }
  has(component: string, name: string): boolean { return this.byRef.has(`${component}/${name}`); }
}

/** 조립 단일 지점 — 동기·비동기·증분 세 경로가 모두 이 함수만 쓴다. */
function addRef(map: RefMap, file: string, component: string, name: string): void {
  const key = `${component}/${name}`;
  const arr = map.get(key);
  if (arr) arr.push({ uri: file, line: 0, column: 0 });
  else map.set(key, [{ uri: file, line: 0, column: 0 }]);
}
