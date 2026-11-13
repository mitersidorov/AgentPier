import { Controller, Get, Param, Query } from '@nestjs/common';
import { AgentProfileService } from '../../agents/services/agent-profile.service';
import { BackupService } from '../../backup/services/backup.service';
import { CodexAppServerService } from '../../integrations/codex/services/codex-app-server.service';
import { ManagerService } from '../../manager/services/manager.service';
import { DashboardRecordsQueryDto } from '../dto/dashboard-records-query.dto';
import { DashboardRecordParamsDto } from '../dto/dashboard-record-params.dto';

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly manager: ManagerService,
    private readonly codex: CodexAppServerService,
    private readonly profiles: AgentProfileService,
    private readonly backups: BackupService,
  ) {}

  @Get('status') async systemStatus() {
    const [database, appServer, backupStorage] = await Promise.all([
      this.manager.databaseStatus(),
      this.codex.status(),
      this.backups.storageStatus(),
    ]);
    return {
      database,
      mcp: { ready: true, transport: 'Streamable HTTP', path: '/mcp' },
      appServer,
      backupStorage,
    };
  }

  @Get('records') list(@Query() query: DashboardRecordsQueryDto) {
    return this.manager.list(query.kind, query.projectId);
  }

  @Get('records/:id') get(@Param() params: DashboardRecordParamsDto) {
    return this.manager.get(params.id);
  }

  @Get('agents') agents() {
    return this.profiles.list();
  }
}
