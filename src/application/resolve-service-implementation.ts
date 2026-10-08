import { DeclaredServiceImplementation, ServiceDeclarationReader, TextSpan } from '../domain/service-model/ports/service-declaration-reader';
import { ServiceImplementationFinder } from '../domain/service-model/ports/service-implementation-finder';
import { SourceLocation } from '../domain/shared/value-objects';
import { DefinitionResult, RangeItem } from './dto';

/** Moodle은 `methodname`이 빠진 선언을 `execute`로 등록한다. */
const DEFAULT_METHOD = 'execute';

interface ResolvedLink { span: TextSpan; location: SourceLocation; }

/** `db/services.php`의 `classname`·`methodname` 값 → 구현 클래스·메서드. */
export class ResolveServiceImplementation {
  constructor(private reader: ServiceDeclarationReader, private finder: ServiceImplementationFinder) {}

  run(text: string, component: string, line: number, character: number): DefinitionResult[] {
    const hit = this.linksIn(text, component, d => [d.classnameSpan, d.methodnameSpan].some(s => s && contains(s, line, character)))
      .find(l => contains(l.span, line, character));
    return hit ? [{ location: hit.location, origin: hit.span }] : [];
  }

  resolvedRanges(text: string, component: string): RangeItem[] {
    return this.linksIn(text, component, () => true).map(l => l.span);
  }

  /** API 트리 항목 → 메서드(없으면 클래스) 위치. */
  locate(text: string, component: string, functionName: string): SourceLocation | null {
    const declaration = this.reader.implementationsIn(text).find(d => d.name === functionName);
    if (!declaration) return null;
    const found = this.finder.find(refOf(declaration, component));
    return found ? found.methodAt ?? found.classAt : null;
  }

  private linksIn(text: string, component: string,
                  wanted: (d: DeclaredServiceImplementation) => boolean): ResolvedLink[] {
    const links: ResolvedLink[] = [];
    for (const declaration of this.reader.implementationsIn(text)) {
      if (!declaration.classname || !wanted(declaration)) continue;
      const found = this.finder.find(refOf(declaration, component));
      if (!found) continue;
      if (declaration.classnameSpan) links.push({ span: declaration.classnameSpan, location: found.classAt });
      if (declaration.methodnameSpan && found.methodAt) links.push({ span: declaration.methodnameSpan, location: found.methodAt });
    }
    return links;
  }
}

function refOf(d: DeclaredServiceImplementation, component: string) {
  return { component, classname: d.classname, methodname: d.methodname || DEFAULT_METHOD, classpath: d.classpath };
}

function contains(span: TextSpan, line: number, character: number): boolean {
  return span.line === line && character >= span.column0 && character <= span.column0 + span.length;
}
