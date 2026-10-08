import * as fs from 'fs';
import * as path from 'path';
import { ClassOutline, ClassOutlineReader } from '../../domain/code-analysis/ports/class-outline-reader';
import { ServiceImplementation, ServiceImplementationFinder, ServiceImplementationRef } from '../../domain/service-model/ports/service-implementation-finder';
import { SourceLocation } from '../../domain/shared/value-objects';
import { coreSubsystemDirs, pluginTypeDirs } from '../workspace/plugin-type-map';

interface CachedOutline { mtimeMs: number; size: number; classes: ClassOutline[]; }
interface LocatedClass { file: string; outline: ClassOutline; }

/** 부모를 따라 올라가는 깊이 상한 — 순환 상속이나 끝없는 체인에서 멈춘다. */
const MAX_PARENT_DEPTH = 8;

/** Moodle `external_api::external_function_info`와 같은 순서로 찾는다: 먼저 클래스 자동 로드 경로,
 *  없으면 `classpath`, 그것도 비었으면 선언한 컴포넌트의 `externallib.php`.
 *  하이라이트가 편집마다 부르므로 파일 개요는 mtime·크기가 같으면 다시 읽지 않는다. */
export class ExternalImplementationFinder implements ServiceImplementationFinder {
  private outlines = new Map<string, CachedOutline>();

  constructor(private root: string, private reader: ClassOutlineReader) {}

  find(ref: ServiceImplementationRef): ServiceImplementation | null {
    const classname = ref.classname.replace(/^\\/, '');
    const found = this.locateClass(classname, this.candidateFiles(ref, classname));
    if (!found) return null;
    return {
      classAt: { uri: found.file, line: found.outline.line, column: found.outline.column },
      methodAt: this.methodIn(found, ref.methodname.toLowerCase()),
    };
  }

  /** 메서드가 클래스에 없으면 `extends`를 따라 부모에서 찾는다 — 같은 파일을 먼저, 그다음 자동 로드 경로. */
  private methodIn(start: LocatedClass, method: string): SourceLocation | null {
    let current: LocatedClass | null = start;
    for (let depth = 0; current && depth < MAX_PARENT_DEPTH; depth++) {
      const m = current.outline.methods.find(x => x.name.toLowerCase() === method);
      if (m) return { uri: current.file, line: m.line, column: m.column };
      const parent: string | null = current.outline.parent;
      current = parent ? this.locateClass(parent, [current.file, ...autoloadedFiles(this.root, parent)]) : null;
    }
    return null;
  }

  private locateClass(classname: string, files: string[]): LocatedClass | null {
    const wanted = classname.toLowerCase();
    for (const file of files) {
      const outline = this.classesIn(file).find(c => c.name.toLowerCase() === wanted);
      if (outline) return { file, outline };
    }
    return null;
  }

  private candidateFiles(ref: ServiceImplementationRef, classname: string): string[] {
    const files = autoloadedFiles(this.root, classname);
    if (ref.classpath) files.push(path.join(this.root, ref.classpath));
    else {
      const dir = componentDir(this.root, ref.component);
      if (dir) files.push(path.join(dir, 'externallib.php'));
    }
    return files;
  }

  private classesIn(file: string): ClassOutline[] {
    let stat: fs.Stats;
    try { stat = fs.statSync(file); } catch { return []; }
    const cached = this.outlines.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.classes;
    let text: string;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
    const classes = this.reader.classOutlines(text);
    this.outlines.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, classes });
    return classes;
  }
}

/** `core_component`의 클래스 맵 규칙: `<컴포넌트>\a\b` → `classes/a/b.php`,
 *  `<컴포넌트>_<파일>` → `classes/<파일>.php`(classes 바로 아래 파일만). */
function autoloadedFiles(root: string, classname: string): string[] {
  if (classname.includes('\\')) {
    const [component, ...rest] = classname.split('\\');
    const dir = componentDir(root, component);
    return dir && rest.length ? [path.join(dir, 'classes', ...rest) + '.php'] : [];
  }
  const files: string[] = [];
  for (let i = classname.indexOf('_'); i > 0; i = classname.indexOf('_', i + 1)) {
    const dir = componentDir(root, classname.slice(0, i));
    if (dir) files.push(path.join(dir, 'classes', classname.slice(i + 1) + '.php'));
  }
  return files;
}

function componentDir(root: string, component: string): string | null {
  if (component === 'core') return path.join(root, 'lib');
  const i = component.indexOf('_');
  if (i < 0) return null;
  const type = component.slice(0, i), name = component.slice(i + 1);
  if (type === 'core') {
    const sub = coreSubsystemDirs(root).get(name);
    return sub ? path.join(root, sub) : null;
  }
  const typeDir = pluginTypeDirs(root).get(type);
  return typeDir ? path.join(root, typeDir, name) : null;
}
