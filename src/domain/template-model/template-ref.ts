import { ModuleRef, parseModuleRef } from '../shared/module-ref';

export type TemplateRef = ModuleRef;

/** 템플릿 참조 분해 — AMD 모듈 참조와 규칙이 같아 공유 파서에 위임한다. */
export const parseTemplateRef = parseModuleRef;
