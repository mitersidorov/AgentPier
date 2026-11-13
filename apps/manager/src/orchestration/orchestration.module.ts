import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { BackupModule } from '../backup/backup.module';
import { CodexModule } from '../integrations/codex/codex.module';
import { ManagerModule } from '../manager/manager.module';
import { SessionsModule } from '../sessions/sessions.module';
import { TaskOrchestratorService } from './services/task-orchestrator.service';

// Coordinates analysis and approved Codex implementation sessions.
@Module({
  imports: [AgentsModule, BackupModule, CodexModule, ManagerModule, SessionsModule],
  providers: [TaskOrchestratorService],
  exports: [TaskOrchestratorService],
})
export class OrchestrationModule {}
