import { Module } from '@nestjs/common';
import { HealthController } from './controllers/health.controller';
import { HealthService } from './services/health.service';

// Exposes readiness and database health checks.
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
