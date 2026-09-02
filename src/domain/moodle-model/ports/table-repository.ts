import { Table } from '../table';
export interface TableRepository {
  getTable(name: string): Table | undefined;
  allTableNames(): string[];
  /** 그 install.xml이 선언한 테이블 — 선언 줄에서 대상을 판정할 때 쓴다. */
  tablesIn(file: string): Table[];
}
