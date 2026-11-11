import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash, randomUUID } from 'node:crypto';
import { S3StorageService } from '../common/s3/s3-storage.service';
import { ManagerService } from '../manager/manager.service';

type SnapshotTable = { name: string; createSql: string; rows: any[] };

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly prefix = (process.env.S3_PREFIX || 'agentpier/').replace(/^\/+|\/*$/g, '') + '/';
  private readonly retentionDays = Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS) || 30);
  private readonly restoreDatabase = process.env.RESTORE_TEST_DB || 'agentpier_restore_test';

  constructor(
    private readonly source: DataSource,
    private readonly s3: S3StorageService,
    private readonly manager: ManagerService,
  ) {}

  @Cron(process.env.BACKUP_SCHEDULE || '0 2 * * *')
  async scheduledBackup() {
    await this.createBackup('scheduled');
  }

  async createBackup(type: string, verifyRestore = false) {
    const startedAt = new Date().toISOString();
    const operation = await this.manager.create('backup', {
      type,
      status: 'running',
      startedAt,
      verifyRestore,
      bucket: this.s3.bucketName,
    });
    let key: string | undefined;
    let sizeBytes: number | undefined;
    let sha256: string | undefined;
    try {
      const snapshot = await this.captureSnapshot();
      const body = gzipSync(Buffer.from(JSON.stringify(snapshot)));
      sha256 = createHash('sha256').update(body).digest('hex');
      sizeBytes = body.length;
      key = `${this.prefix}${new Date().toISOString().slice(0, 10)}/agentpier-${Date.now()}-${randomUUID()}.json.gz`;
      await this.s3.uploadFile({ key, body, contentType: 'application/gzip', metadata: { sha256 } });
      let restore: any;
      if (verifyRestore) restore = await this.restoreAndVerify(key, sha256);
      const removed = await this.applyRetention();
      return await this.manager.update(operation.id, {
        ...operation.data,
        status: 'succeeded',
        key,
        sizeBytes,
        sha256,
        tableCounts: Object.fromEntries(snapshot.tables.map((table) => [table.name, table.rows.length])),
        restore,
        prunedObjects: removed,
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      return this.manager.update(operation.id, {
        ...operation.data,
        status: 'failed',
        ...(key ? { key, sizeBytes, sha256, uploaded: true } : {}),
        error: this.safeError(error),
        finishedAt: new Date().toISOString(),
      });
    }
  }

  async status() {
    return this.manager.list('backup');
  }

  private async captureSnapshot() {
    const queryRunner = this.source.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await queryRunner.startTransaction();
    try {
      const tableRows = await queryRunner.query(
        'SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = "BASE TABLE" ORDER BY TABLE_NAME',
      );
      const tables: SnapshotTable[] = [];
      for (const tableRow of tableRows) {
        const name = String(Object.values(tableRow)[0]);
        if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error('Database contains an unsupported table identifier');
        const schemaRows = await queryRunner.query(`SHOW CREATE TABLE \`${name}\``);
        const createSql = String(Object.values(schemaRows[0])[1]);
        const rows = await queryRunner.query(`SELECT * FROM \`${name}\``);
        tables.push({ name, createSql, rows: rows.map((row: any) => this.encode(row)) });
      }
      await queryRunner.commitTransaction();
      return {
        format: 'agentpier-logical-mysql-v1',
        createdAt: new Date().toISOString(),
        database: this.source.options.database,
        tables,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async restoreAndVerify(key: string, expectedDigest: string) {
    if (
      !/^agentpier_restore_test(?:_[a-z0-9]+)?$/.test(this.restoreDatabase) ||
      this.restoreDatabase === this.source.options.database
    ) {
      throw new Error('RESTORE_TEST_DB must be an isolated agentpier_restore_test database name');
    }
    const compressed = await this.s3.downloadFile(key);
    const digest = createHash('sha256').update(compressed).digest('hex');
    if (digest !== expectedDigest) throw new Error('Uploaded backup checksum does not match');
    const snapshot = JSON.parse(gunzipSync(compressed).toString('utf8')) as { format: string; tables: SnapshotTable[] };
    if (snapshot.format !== 'agentpier-logical-mysql-v1') throw new Error('Unsupported backup format');
    const testSource = new DataSource({
      ...(this.source.options as any),
      database: this.restoreDatabase,
      entities: [],
      migrations: [],
      synchronize: false,
      migrationsRun: false,
    });
    await testSource.initialize();
    try {
      const tableNames = await testSource.query(
        'SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()',
      );
      for (const row of tableNames) {
        const name = String(Object.values(row)[0]);
        if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error('Restore database contains an unsupported table identifier');
        await testSource.query(`DROP TABLE \`${name}\``);
      }
      const tables: Record<string, { expectedRows: number; restoredRows: number; checksumMatches: boolean }> = {};
      for (const table of snapshot.tables) {
        if (!/^[A-Za-z0-9_]+$/.test(table.name)) throw new Error('Backup contains an unsupported table identifier');
        await testSource.query(table.createSql);
        const columns = table.rows.length ? Object.keys(this.decode(table.rows[0])) : [];
        if (columns.length) {
          const columnSql = columns.map((column) => `\`${column.replace(/`/g, '')}\``).join(',');
          const placeholders = columns.map(() => '?').join(',');
          for (const encoded of table.rows) {
            const row = this.decode(encoded);
            await testSource.query(
              `INSERT INTO \`${table.name}\` (${columnSql}) VALUES (${placeholders})`,
              columns.map((column) => {
                const value = row[column];
                return value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)
                  ? JSON.stringify(value)
                  : value;
              }),
            );
          }
        }
        const restored = await testSource.query(`SELECT * FROM \`${table.name}\``);
        const checksumMatches =
          this.rowsDigest(table.rows.map((row) => this.decode(row))) === this.rowsDigest(restored);
        tables[table.name] = { expectedRows: table.rows.length, restoredRows: restored.length, checksumMatches };
        if (!checksumMatches || restored.length !== table.rows.length)
          throw new Error(`Restore verification failed for table ${table.name}`);
      }
      return { database: this.restoreDatabase, verified: true, tables };
    } finally {
      await testSource.destroy();
    }
  }

  private async applyRetention() {
    const files = await this.s3.listFiles(this.prefix);
    const cutoff = Date.now() - this.retentionDays * 86400000;
    const expired = files.filter((file) => file.lastModified && file.lastModified.getTime() < cutoff);
    for (const file of expired) await this.s3.deleteFile(file.key);
    return expired.length;
  }

  private encode(value: any): any {
    if (value instanceof Date) return { __agentpierType: 'date', value: value.toISOString() };
    if (Buffer.isBuffer(value)) return { __agentpierType: 'buffer', value: value.toString('base64') };
    if (typeof value === 'bigint') return { __agentpierType: 'bigint', value: value.toString() };
    if (Array.isArray(value)) return value.map((child) => this.encode(child));
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, this.encode(child)]));
    return value;
  }

  private decode(value: any): any {
    if (Array.isArray(value)) return value.map((child) => this.decode(child));
    if (!value || typeof value !== 'object') return value;
    if (value.__agentpierType === 'date') return new Date(value.value);
    if (value.__agentpierType === 'buffer') return Buffer.from(value.value, 'base64');
    if (value.__agentpierType === 'bigint') return value.value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, this.decode(child)]));
  }

  private rowsDigest(rows: any[]) {
    const normalized = rows.map((row) => JSON.stringify(this.encode(row))).sort();
    return createHash('sha256').update(normalized.join('\n')).digest('hex');
  }

  private safeError(error: unknown) {
    return this.errorMessage(error)
      .replace(/(password|secret|token|credential)[=: ]+[^\s,;]+/gi, '$1=[REDACTED]')
      .slice(0, 1500);
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown backup error';
  }
}
