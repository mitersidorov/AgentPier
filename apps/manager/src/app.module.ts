import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './common/database/database.module';
import { ErrorModule } from './common/error/error.module';
import { HealthModule } from './health/health.module';
import { ManagerModule } from './manager/manager.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AgentsModule } from './agents/agents.module';
import { CodexModule } from './integrations/codex/codex.module';
import { ProjectsModule } from './projects/projects.module';
import { ApplicationsModule } from './applications/applications.module';
import { BackupModule } from './backup/backup.module';
import { MemoryModule } from './memory/memory.module';
import { OrchestrationModule } from './orchestration/orchestration.module';
import { SessionsModule } from './sessions/sessions.module';
import { TasksModule } from './tasks/tasks.module';
import { McpModule } from './mcp/mcp.module';

// Composes MCP workflows, dashboard read views, domains, and infrastructure.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
    DatabaseModule,
    ErrorModule,
    ManagerModule,
    CodexModule,
    AgentsModule,
    ProjectsModule,
    ApplicationsModule,
    BackupModule,
    MemoryModule,
    OrchestrationModule,
    SessionsModule,
    TasksModule,
    McpModule,
    DashboardModule,
    HealthModule,
  ],
})
export class AppModule {}
