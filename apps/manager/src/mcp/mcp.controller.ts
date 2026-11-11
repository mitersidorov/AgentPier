import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AgentProfileService } from '../agents/agent-profile.service';
import { BackupService } from '../backup/backup.service';
import { CodexAppServerService } from '../integrations/codex/codex-app-server.service';
import { ManagerService } from '../manager/manager.service';
import { ProjectService } from '../projects/project.service';
import { ApplicationService } from '../applications/application.service';
import { MemoryService } from '../memory/memory.service';
import { TaskService } from '../tasks/task.service';

const tools = [
  {
    name: 'manager_status',
    description: 'Check Manager, MySQL and the live Codex app-server WebSocket',
    inputSchema: { type: 'object', properties: {} },
  },
  { name: 'list_projects', description: 'List registered projects', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'register_project',
    description: 'Register a project and its absolute Mac checkout path',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        path: { type: 'string' },
        description: { type: 'string' },
        instructions: { type: 'string' },
        constraints: { type: 'string' },
      },
      required: ['name', 'path'],
    },
  },
  {
    name: 'update_project',
    description: 'Update project metadata or constraints',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, data: { type: 'object' } },
      required: ['projectId', 'data'],
    },
  },
  {
    name: 'manage_applications',
    description: 'List, register or update project applications and repositories',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'register', 'update'] },
        projectId: { type: 'string' },
        recordId: { type: 'string' },
        kind: { type: 'string', enum: ['app', 'repository'] },
        data: { type: 'object' },
      },
      required: ['action', 'projectId'],
    },
  },
  {
    name: 'list_agents',
    description: 'List the two universal profiles and their current instruction versions',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_project_context',
    description: 'Read project instructions, registered apps and confirmed project memory',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  },
  {
    name: 'update_project_context',
    description: 'Create or update a project instruction or memory record with provenance',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        kind: { type: 'string', enum: ['instruction', 'memory'] },
        recordId: { type: 'string' },
        data: { type: 'object' },
        userConfirmed: { type: 'boolean' },
      },
      required: ['projectId', 'kind', 'data'],
    },
  },
  {
    name: 'analyze_task',
    description: 'Launch new read-only Codex analysis sessions for the selected project applications',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, request: { type: 'string' } },
      required: ['projectId', 'request'],
    },
  },
  {
    name: 'get_analysis_results',
    description: 'Read saved analysis results, agent messages and session IDs',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
  },
  {
    name: 'save_plan',
    description: 'Save or replace a draft plan after discussion of analysis results',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' }, plan: { type: 'object' } },
      required: ['taskId', 'plan'],
    },
  },
  {
    name: 'approve_plan',
    description: 'Persist the final plan after the user explicitly confirms it',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' }, plan: { type: 'object' }, userConfirmed: { type: 'boolean' } },
      required: ['taskId', 'plan', 'userConfirmed'],
    },
  },
  {
    name: 'execute_task',
    description: 'Execute an explicitly approved dependency plan in new Codex threads and local Git branches',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
  },
  {
    name: 'get_task_status',
    description: 'Get task, subtask, Codex session and reconnect state',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
  },
  {
    name: 'get_agent_messages',
    description: 'Read agent questions, streamed messages and user replies',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
  },
  {
    name: 'send_agent_message',
    description: 'Answer an agent question or send additional direction to a managed thread',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        sessionId: { type: 'string' },
        message: { type: 'string' },
        questionMessageId: { type: 'string' },
        answers: { type: 'object' },
      },
      required: ['taskId', 'sessionId'],
    },
  },
  {
    name: 'cancel_task',
    description: 'Interrupt active task turns while keeping saved task history',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
  },
  {
    name: 'get_task_results',
    description: 'Return Codex results, local branches, changed files and checks',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
  },
  {
    name: 'backup_database',
    description:
      'Create and upload a consistent MySQL backup, optionally restore it into the isolated verification database',
    inputSchema: { type: 'object', properties: { verifyRestore: { type: 'boolean' } } },
  },
  {
    name: 'get_backup_status',
    description: 'List backup/restore operation journal records',
    inputSchema: { type: 'object', properties: {} },
  },
];

@Controller('mcp')
export class McpController {
  constructor(
    private readonly manager: ManagerService,
    private readonly profiles: AgentProfileService,
    private readonly codex: CodexAppServerService,
    private readonly backup: BackupService,
    private readonly projects: ProjectService,
    private readonly applications: ApplicationService,
    private readonly memory: MemoryService,
    private readonly tasks: TaskService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(@Body() message: Record<string, any>, @Res() response: Response) {
    const send = (payload: Record<string, any>) => response.status(200).json(payload);
    const id = message.id ?? null;
    if (message.method === 'initialize')
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: message.params?.protocolVersion || '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'agentpier-manager', version: '0.2.0' },
        },
      });
    if (message.method === 'notifications/initialized') return response.status(202).send();
    if (message.method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools } });
    if (message.method === 'tools/call') {
      const { name, arguments: args = {} } = message.params || {};
      try {
        const result = await this.callTool(name, args);
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

  private async callTool(name: string, args: Record<string, any>): Promise<unknown> {
    switch (name) {
      case 'manager_status':
        return { manager: 'ok', database: await this.manager.databaseStatus(), appServer: await this.codex.status() };
      case 'list_projects':
        return this.projects.list();
      case 'register_project':
        return this.projects.register(args);
      case 'update_project':
        return this.projects.update(args.projectId, args.data);
      case 'manage_applications':
        return this.applications.manage(args as any);
      case 'list_agents':
        return this.profiles.list();
      case 'get_project_context':
        return this.manager.getProjectContext(args.projectId);
      case 'update_project_context': {
        if (!['instruction', 'memory'].includes(args.kind))
          throw new Error('Only instruction or memory records may be changed here');
        return this.memory.update(args as any);
      }
      case 'analyze_task':
        return this.tasks.analyze(args.projectId, args.request);
      case 'get_analysis_results':
        return this.tasks.analysis(args.taskId);
      case 'save_plan':
        return this.tasks.draft(args.taskId, args.plan);
      case 'approve_plan': {
        if (args.userConfirmed !== true) throw new Error('The user must explicitly confirm the plan before approval');
        return this.tasks.approve(args.taskId, args.plan, true);
      }
      case 'execute_task':
        return this.tasks.execute(args.taskId);
      case 'get_task_status':
        return this.tasks.status(args.taskId);
      case 'get_agent_messages':
        return this.tasks.messages(args.taskId);
      case 'send_agent_message':
        return this.tasks.sendMessage(args as any);
      case 'cancel_task':
        return this.tasks.cancel(args.taskId);
      case 'get_task_results':
        return this.tasks.results(args.taskId);
      case 'backup_database':
        return this.backup.createBackup(
          args.verifyRestore === true ? 'manual-verified' : 'manual',
          args.verifyRestore === true,
        );
      case 'get_backup_status':
        return this.backup.status();
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
