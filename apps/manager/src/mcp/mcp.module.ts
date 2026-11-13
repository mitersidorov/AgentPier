import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { ApplicationsModule } from '../applications/applications.module';
import { BackupModule } from '../backup/backup.module';
import { CodexModule } from '../integrations/codex/codex.module';
import { ManagerModule } from '../manager/manager.module';
import { MemoryModule } from '../memory/memory.module';
import { ProjectsModule } from '../projects/projects.module';
import { TasksModule } from '../tasks/tasks.module';
import { McpController } from './controllers/mcp.controller';

// Exposes Manager workflow operations through the local MCP endpoint.
@Module({
  imports: [
    AgentsModule,
    ApplicationsModule,
    BackupModule,
    CodexModule,
    ManagerModule,
    MemoryModule,
    ProjectsModule,
    TasksModule,
  ],
  controllers: [McpController],
})
export class McpModule {}
