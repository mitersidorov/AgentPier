import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'node:path';
import { ManagerService } from './manager.service';
import { TaskOrchestratorService } from '../orchestration/task-orchestrator.service';
import { CodexAppServerService } from '../integrations/codex/codex-app-server.service';

@Controller()
export class ManagerController {
  constructor(
    private readonly manager: ManagerService,
    private readonly orchestration: TaskOrchestratorService,
    private readonly codex: CodexAppServerService,
  ) {}

  @Get() home(@Res() response: Response) {
    return response.sendFile(join(process.cwd(), 'apps/manager/public/index.html'));
  }
  @Get('api/status') async systemStatus() {
    return { manager: 'ok', database: await this.manager.databaseStatus(), appServer: await this.codex.status() };
  }
  @Get('api/records') list(@Query('kind') kind?: string, @Query('projectId') projectId?: string) {
    return this.manager.list(kind, projectId);
  }
  @Get('api/records/:id') get(@Param('id') id: string) {
    return this.manager.get(id);
  }
  @Post('api/records/:kind') create(@Param('kind') kind: string, @Body() body: Record<string, any>) {
    return this.manager.create(kind, body, body.projectId);
  }
  @Put('api/records/:id') update(@Param('id') id: string, @Body() body: Record<string, any>) {
    return this.manager.update(id, body);
  }
  @Post('api/projects/:id/analyze') analyze(@Param('id') id: string, @Body() body: { request: string }) {
    return this.orchestration.analyze(id, body.request);
  }
  @Post('api/tasks/:id/plan') savePlan(@Param('id') id: string, @Body() body: { plan: Record<string, any> }) {
    return this.manager.saveDraftPlan(id, body.plan);
  }
  @Post('api/tasks/:id/approve') approve(
    @Param('id') id: string,
    @Body() body: { plan: Record<string, any>; userConfirmed?: boolean },
  ) {
    if (body.userConfirmed !== true)
      throw new BadRequestException('The user must explicitly confirm the plan before approval');
    return this.manager.approvePlan(id, { ...body.plan, explicitlyConfirmed: true, confirmationSource: 'user' });
  }
  @Get('api/tasks/:id/analysis') analysis(@Param('id') id: string) {
    return this.orchestration.getAnalysisResults(id);
  }
  @Get('api/tasks/:id/messages') messages(@Param('id') id: string) {
    return this.orchestration.messages(id);
  }
  @Post('api/tasks/:id/messages') sendMessage(
    @Param('id') id: string,
    @Body()
    body: { sessionId: string; message?: string; questionMessageId?: string; answers?: Record<string, string[]> },
  ) {
    return this.orchestration.sendMessage({ taskId: id, ...body });
  }
  @Get('api/tasks/:id/results') results(@Param('id') id: string) {
    return this.orchestration.results(id);
  }
  @Post('api/tasks/:id/cancel') cancel(@Param('id') id: string) {
    return this.orchestration.cancel(id);
  }
  @Post('api/tasks/:id/execute') execute(@Param('id') id: string) {
    return this.orchestration.execute(id);
  }
  @Get('api/tasks/:id/status') status(@Param('id') id: string) {
    return this.orchestration.status(id);
  }
}
