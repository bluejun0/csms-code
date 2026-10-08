import { SourceLocation } from '../../shared/value-objects';

/** `db/services.php` 선언 하나에서 구현을 찾는 데 쓰는 필드. */
export interface ServiceImplementationRef {
  component: string;
  classname: string;
  methodname: string;
  classpath: string;
}

export interface ServiceImplementation {
  classAt: SourceLocation;
  /** 클래스는 찾았지만 메서드가 없으면 null. */
  methodAt: SourceLocation | null;
}

export interface ServiceImplementationFinder {
  find(ref: ServiceImplementationRef): ServiceImplementation | null;
}
