import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { CodexModule } from '../integrations/codex/codex.module';
import { ManagerModule } from '../manager/manager.module';
import { SessionsModule } from '../sessions/sessions.module';
import { TaskOrchestratorService } from './services/task-orchestrator.service';
import { CodexSessionCoordinatorService } from './services/codex-session-coordinator.service';
import { ManagedAgentSessionService } from './services/managed-agent-session.service';

// Coordinates analysis and approved Codex implementation sessions.
@Module({
  imports: [AgentsModule, CodexModule, ManagerModule, SessionsModule],
  providers: [TaskOrchestratorService, CodexSessionCoordinatorService, ManagedAgentSessionService],
  exports: [TaskOrchestratorService],
})
export class OrchestrationModule {}
