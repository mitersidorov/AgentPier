import { DataSource } from 'typeorm';
import { AppDataSource } from '../config/data-source';

class DiscoveryDataSource extends DataSource {
  async discover() {
    await this.buildMetadatas();
  }
}

describe('Development migration discovery', () => {
  it('loads the Manager entity and migrations without connecting or synchronizing', async () => {
    const source = new DiscoveryDataSource(AppDataSource.options);

    await source.discover();

    expect(source.isInitialized).toBe(false);
    expect(source.options.synchronize).toBe(false);
    expect(source.entityMetadatas.map((metadata) => metadata.tableName)).toEqual(['manager_records']);
    expect(source.migrations.map((migration) => migration.name)).toEqual(['CreateManagerRecords1762900000000']);
  });
});
