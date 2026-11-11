import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './common/database/database.module';
import { S3Module } from './common/s3/s3.module';
import { ErrorModule } from './common/error/error.module';
import { HealthModule } from './health/health.module';
import { ManagerModule } from './manager/manager.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
    DatabaseModule,
    S3Module,
    ErrorModule,
    HealthModule,
    ManagerModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
