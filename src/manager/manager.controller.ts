import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'node:path';
import { AppServerService } from './services/app-server.service';
import { ManagerService } from './manager.service';

@Controller()
export class ManagerController {
  constructor(
    private readonly manager: ManagerService,
    private readonly appServer: AppServerService,
  ) {}

  @Get() home(@Res() response: Response) {
    return response.sendFile(join(process.cwd(), 'public', 'index.html'));
  }

  @Get('api/status') async status() {
    const [appServer, database] = await Promise.all([this.appServer.websocketCheck(), this.manager.databaseStatus()]);
    return { manager: 'ok', database, appServer };
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
    return this.manager.saveAnalysis(id, body.request);
  }
  @Post('api/tasks/:id/approve') approve(@Param('id') id: string, @Body() body: { plan: Record<string, any> }) {
    return this.manager.approvePlan(id, body.plan);
  }

  @Post('mcp')
  @HttpCode(200)
  async mcp(@Body() message: Record<string, any>, @Res() response: Response) {
    const send = (payload: Record<string, any>) => response.status(200).json(payload);
    const id = message.id ?? null;
    if (message.method === 'initialize')
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: message.params?.protocolVersion || '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'agentpier-manager', version: '0.1.0' },
        },
      });
    if (message.method === 'notifications/initialized') return response.status(202).send();
    if (message.method === 'tools/list')
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'manager_status',
              description: 'Check Manager, MySQL and real Codex app-server WebSocket status',
              inputSchema: { type: 'object', properties: {} },
            },
            {
              name: 'list_records',
              description: 'List projects, applications, repositories, instructions, skills, tasks or memory',
              inputSchema: { type: 'object', properties: { kind: { type: 'string' }, projectId: { type: 'string' } } },
            },
            {
              name: 'get_record',
              description: 'Read one project, task, instruction, skill or memory record',
              inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
            },
            {
              name: 'create_record',
              description: 'Create a project, app, repository, instruction, skill or memory record',
              inputSchema: {
                type: 'object',
                properties: { kind: { type: 'string' }, projectId: { type: 'string' }, data: { type: 'object' } },
                required: ['kind', 'data'],
              },
            },
            {
              name: 'update_record',
              description: 'Update a project or project context record',
              inputSchema: {
                type: 'object',
                properties: { id: { type: 'string' }, data: { type: 'object' } },
                required: ['id', 'data'],
              },
            },
            {
              name: 'start_analysis',
              description:
                'Persist the verbatim request as a pending analysis record; this does not launch a Codex session',
              inputSchema: {
                type: 'object',
                properties: { projectId: { type: 'string' }, request: { type: 'string' } },
                required: ['projectId', 'request'],
              },
            },
            {
              name: 'approve_plan',
              description: 'Persist a plan only when the user has explicitly confirmed it',
              inputSchema: {
                type: 'object',
                properties: { taskId: { type: 'string' }, plan: { type: 'object' } },
                required: ['taskId', 'plan'],
              },
            },
          ],
        },
      });
    if (message.method === 'tools/call') {
      const { name, arguments: args = {} } = message.params || {};
      try {
        let result: unknown;
        if (name === 'manager_status')
          result = {
            manager: 'ok',
            database: await this.manager.databaseStatus(),
            appServer: await this.appServer.websocketCheck(),
          };
        else if (name === 'list_records') result = await this.manager.list(args.kind, args.projectId);
        else if (name === 'get_record') result = await this.manager.get(args.id);
        else if (name === 'create_record') result = await this.manager.create(args.kind, args.data, args.projectId);
        else if (name === 'update_record') result = await this.manager.update(args.id, args.data);
        else if (name === 'start_analysis') result = await this.manager.saveAnalysis(args.projectId, args.request);
        else if (name === 'approve_plan') result = await this.manager.approvePlan(args.taskId, args.plan);
        else return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${name}` } });
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
      } catch (error) {
        return send({
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [{ type: 'text', text: error instanceof Error ? error.message : 'Manager tool failed' }],
          },
        });
      }
    }
    return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${message.method}` } });
  }
}
