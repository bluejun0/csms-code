import { Table } from '../table';

/** 플러그인 탐색기용 열거. 조회 포트(TableRepository)와 분리해 둔다 — 키로 찾는 쪽은 열거를 쓰지 않는다. */
export interface TableCatalog {
  components(): string[];
  tablesOf(component: string): Table[];
}
