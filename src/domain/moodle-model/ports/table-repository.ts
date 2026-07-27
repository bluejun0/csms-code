import { Table } from '../table';
export interface TableRepository {
  getTable(name: string): Table | undefined;
  allTableNames(): string[];
}
