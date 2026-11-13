import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { BackupModule } from '../backup/backup.module';
import { CodexModule } from '../integrations/codex/codex.module';
import { ManagerModule } from '../manager/manager.module';
import { DashboardController } from './controllers/dashboard.controller';

// Provides read-only data for the local AgentPier dashboard.
@Module({
  imports: [AgentsModule, BackupModule, CodexModule, ManagerModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
