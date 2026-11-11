import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateManagerRecords1762900000000 implements MigrationInterface {
  name = 'CreateManagerRecords1762900000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE manager_records (
      id varchar(36) NOT NULL PRIMARY KEY,
      kind varchar(48) NOT NULL,
      project_id varchar(36) NULL,
      name varchar(255) NULL,
      data json NOT NULL,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX IDX_manager_records_kind (kind),
      INDEX IDX_manager_records_project (project_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE manager_records');
  }
}
