import { SourceLocation } from '../shared/value-objects';

export interface Field {
  name: string; type: string; comment: string;
  notnull: boolean; default: string | null; location: SourceLocation;
}

export class Table {
  constructor(
    readonly name: string,
    readonly component: string,
    readonly fields: Field[],
    readonly location: SourceLocation,
  ) {}
  fieldNames(): string[] { return this.fields.map(f => f.name); }
  findField(name: string): Field | undefined { return this.fields.find(f => f.name === name); }
  hasField(name: string): boolean { return this.findField(name) !== undefined; }
}
