import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggingModule } from '../logging/logging.module';
import { S3StorageService } from './services/s3-storage.service';

// Provides the configured S3-compatible backup destination.
@Module({
  imports: [ConfigModule, LoggingModule],
  providers: [S3StorageService],
  exports: [S3StorageService],
})
export class S3Module {}
