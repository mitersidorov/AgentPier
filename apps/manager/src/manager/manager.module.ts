import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ManagerRecord } from './entities/manager-record.entity';
import { ManagerController } from './manager.controller';
import { ManagerService } from './manager.service';
import { AgentProfileService } from '../agents/agent-profile.service';
import { CodexAppServerService } from '../integrations/codex/codex-app-server.service';
import { TaskOrchestratorService } from '../orchestration/task-orchestrator.service';
import { BackupService } from '../backup/backup.service';
import { McpController } from '../mcp/mcp.controller';
import { ProjectService } from '../projects/project.service';
import { ApplicationService } from '../applications/application.service';
import { TaskService } from '../tasks/task.service';
import { SessionService } from '../sessions/session.service';
import { MemoryService } from '../memory/memory.service';

@Module({
  imports: [TypeOrmModule.forFeature([ManagerRecord])],
  controllers: [ManagerController, McpController],
  providers: [
    ManagerService,
    ProjectService,
    ApplicationService,
    TaskService,
    SessionService,
    MemoryService,
    AgentProfileService,
    CodexAppServerService,
    TaskOrchestratorService,
    BackupService,
  ],
})
export class ManagerModule implements OnModuleInit {
  constructor(
    private readonly manager: ManagerService,
    private readonly profiles: AgentProfileService,
  ) {}
  async onModuleInit() {
    const profiles = await this.profiles.list();
    await this.manager.seedProfiles(
      profiles.map((profile) => ({ role: profile.role, instructions: profile.profile, version: profile.version })),
    );
  }
}
