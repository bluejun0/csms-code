import * as fs from 'fs';
import { Table } from '../../domain/moodle-model/table';
import { TableRepository } from '../../domain/moodle-model/ports/table-repository';
import { parseInstallXml, InMemoryTableRepository } from '../xmldb/xmldb-table-repository';
import { listInstallXmlFiles } from '../workspace/moodle-root-resolver';

export class IndexStore implements TableRepository {
  private repo = new InMemoryTableRepository();

  buildFromRoot(root: string): void {
    const all: Table[] = [];
    for (const { file, component } of listInstallXmlFiles(root)) {
      all.push(...safeParse(file, component));
    }
    this.repo.replaceAll(all);
  }
  /** install.xml 하나가 바뀌면 그 파일의 테이블만 갱신 */
  updateFile(file: string, component: string): void {
    this.repo.removeByUri(file);
    this.repo.upsert(safeParse(file, component));
  }
  removeFile(uri: string): void { this.repo.removeByUri(uri); }

  getTable(name: string) { return this.repo.getTable(name); }
  allTableNames() { return this.repo.allTableNames(); }
}

function safeParse(file: string, component: string): Table[] {
  try { return parseInstallXml(fs.readFileSync(file, 'utf8'), file, component); }
  catch { return []; }
}
