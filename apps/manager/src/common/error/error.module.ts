import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppExceptionFilter } from './services/app-exception.filter';
import { LoggingModule } from '../logging/logging.module';

// Registers the shared HTTP exception response filter.
@Module({
  imports: [LoggingModule],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AppExceptionFilter,
    },
  ],
})
export class ErrorModule {}
