import { Module } from '@nestjs/common';
import { ManagerModule } from '../manager/manager.module';
import { BackupService } from './services/backup.service';
import { S3Module } from '../common/s3/s3.module';
import { LoggingModule } from '../common/logging/logging.module';

// Creates, verifies, and retains database backups.
@Module({
  imports: [ManagerModule, S3Module, LoggingModule],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
