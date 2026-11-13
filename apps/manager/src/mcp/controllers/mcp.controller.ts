import { BadRequestException, Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { ValidationError, validate } from 'class-validator';
import type { Response } from 'express';
import { AgentProfileService } from '../../agents/services/agent-profile.service';
import { BackupService } from '../../backup/services/backup.service';
import { CodexAppServerService } from '../../integrations/codex/services/codex-app-server.service';
import { ManagerService } from '../../manager/services/manager.service';
import { ProjectService } from '../../projects/services/project.service';
import { ApplicationService } from '../../applications/services/application.service';
import { MemoryService } from '../../memory/services/memory.service';
import { TaskService } from '../../tasks/services/task.service';
import { McpRequestDto } from '../dto/mcp-request.dto';
import { RegisterProjectDto } from '../../projects/dto/register-project.dto';
import { UpdateProjectDto } from '../../projects/dto/update-project.dto';
import { ManageApplicationsDto } from '../../applications/dto/manage-applications.dto';
import { UpdateProjectContextDto } from '../../memory/dto/update-project-context.dto';
import { AnalyzeTaskDto } from '../../tasks/dto/analyze-task.dto';
import { TaskIdDto } from '../../tasks/dto/task-id.dto';
import { SavePlanDto } from '../../tasks/dto/save-plan.dto';
import { ApprovePlanDto } from '../../tasks/dto/approve-plan.dto';
import { SendAgentMessageDto } from '../../tasks/dto/send-agent-message.dto';
import { CreateBackupDto } from '../../backup/dto/create-backup.dto';
import { ProjectContextQueryDto } from '../../projects/dto/project-context-query.dto';
import { DeleteProjectDto } from '../../projects/dto/delete-project.dto';
import { EmptyToolArgumentsDto } from '../dto/empty-tool-arguments.dto';
import { TaskPlanDto } from '../../tasks/dto/task-plan.dto';
import { UpdateAgentProfileDto } from '../../agents/dto/update-agent-profile.dto';

const taskPlanSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    steps: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string', minLength: 1, maxLength: 255 },
          description: { type: 'string', minLength: 1, maxLength: 20000 },
          targetBranch: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$' },
          profile: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,40}$' },
          appId: { type: 'string', format: 'uuid' },
          repositoryId: { type: 'string', format: 'uuid' },
          dependsOn: { type: 'array', items: { type: 'string' } },
          checks: { type: 'array', items: { type: 'string' } },
          releaseOperations: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: {
              oneOf: [
                {
                  type: 'object',
                  properties: {
                    type: { const: 'commit' },
                    paths: { type: 'array', minItems: 1, items: { type: 'string' } },
                  },
                  required: ['type', 'paths'],
                  additionalProperties: false,
                },
                {
                  type: 'object',
                  properties: { type: { const: 'push' }, remote: { type: 'string' }, ref: { type: 'string' } },
                  required: ['type', 'remote', 'ref'],
                  additionalProperties: false,
                },
                {
                  type: 'object',
                  properties: {
                    type: { const: 'pr' },
                    head: { type: 'string' },
                    base: { type: 'string' },
                    action: { enum: ['create', 'update'] },
                  },
                  required: ['type', 'head', 'base', 'action'],
                  additionalProperties: false,
                },
                {
                  type: 'object',
                  properties: {
                    type: { const: 'review' },
                    pr: { type: 'string' },
                    action: { enum: ['comment', 'approve', 'request-changes'] },
                  },
                  required: ['type', 'pr', 'action'],
                  additionalProperties: false,
                },
                {
                  type: 'object',
                  properties: {
                    type: { const: 'merge' },
                    pr: { type: 'string' },
                    method: { enum: ['merge', 'squash', 'rebase'] },
                  },
                  required: ['type', 'pr', 'method'],
                  additionalProperties: false,
                },
              ],
            },
          },
        },
        required: ['title', 'description'],
        additionalProperties: false,
      },
    },
    decisions: { type: 'array', items: { type: 'string' } },
    constraints: { type: 'array', items: { type: 'string' } },
    acceptanceCriteria: { type: 'array', items: { type: 'string' } },
  },
  required: ['steps'],
  additionalProperties: false,
};

const contextDataSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', maxLength: 255 },
    title: { type: 'string', maxLength: 255 },
    category: { type: 'string', enum: ['architecture', 'stack', 'application'] },
    content: { type: 'string', maxLength: 50000 },
    instructions: { type: 'string', maxLength: 50000 },
    description: { type: 'string', maxLength: 20000 },
    rationale: { type: 'string', maxLength: 20000 },
    source: { type: 'string', maxLength: 20000 },
    status: { type: 'string', enum: ['draft', 'confirmed'] },
    constraints: { type: 'array', items: { type: 'string' } },
    decisions: { type: 'array', items: { type: 'string' } },
    acceptanceCriteria: { type: 'array', items: { type: 'string' } },
  },
  minProperties: 1,
  additionalProperties: false,
};

const applicationDataSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 255 },
    purpose: { type: 'string' },
    description: { type: 'string', maxLength: 20000 },
    path: { type: 'string', minLength: 1, maxLength: 4096 },
    repositoryId: { type: 'string', format: 'uuid' },
    remoteUrl: { type: 'string', maxLength: 2048 },
  },
  minProperties: 1,
  additionalProperties: false,
};

const appDataSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 255 },
    purpose: { type: 'string' },
    description: { type: 'string', maxLength: 20000 },
    path: { type: 'string', minLength: 1, maxLength: 4096 },
    repositoryId: { type: 'string', format: 'uuid' },
  },
  minProperties: 1,
  additionalProperties: false,
};

const repositoryDataSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 255 },
    description: { type: 'string', maxLength: 20000 },
    path: { type: 'string', minLength: 1, maxLength: 4096 },
    remoteUrl: { type: 'string', maxLength: 2048 },
  },
  minProperties: 1,
  additionalProperties: false,
};

const tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [
  {
    name: 'manager_status',
    description: 'Check Manager, MySQL and the live Codex app-server WebSocket',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_projects',
    description: 'List registered projects',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'register_project',
    description: 'Register a project and its absolute Mac checkout path',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 255 },
        path: { type: 'string', minLength: 1, maxLength: 4096 },
        description: { type: 'string', maxLength: 20000 },
        instructions: { type: 'string', maxLength: 20000 },
        constraints: { type: 'string', maxLength: 20000 },
      },
      required: ['name', 'path'],
    },
  },
  {
    name: 'update_project',
    description: 'Update project metadata or constraints',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', format: 'uuid' },
        data: {
          type: 'object',
          properties: {
            name: { type: 'string', maxLength: 255, minLength: 1 },
            path: { type: 'string', maxLength: 4096, minLength: 1 },
            description: { type: 'string', maxLength: 20000 },
            instructions: { type: 'string', maxLength: 20000 },
            constraints: { type: 'string', maxLength: 20000 },
          },
          minProperties: 1,
          additionalProperties: false,
        },
      },
      required: ['projectId', 'data'],
    },
  },
  {
    name: 'delete_project',
    description:
      'Confirm active turns have stopped, then transactionally delete project records; errors preserve records and checkout files are kept',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string', format: 'uuid' } },
      required: ['projectId'],
    },
  },
  {
    name: 'manage_applications',
    description: 'List, register or update project applications and repositories',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'register', 'update'] },
        projectId: { type: 'string', format: 'uuid' },
        recordId: { type: 'string', format: 'uuid' },
        kind: { type: 'string', enum: ['app', 'repository'] },
        data: applicationDataSchema,
      },
      required: ['action', 'projectId'],
      allOf: [
        {
          if: { required: ['kind'], properties: { kind: { const: 'app' } } },
          then: { properties: { data: appDataSchema } },
        },
        {
          if: { required: ['kind'], properties: { kind: { const: 'repository' } } },
          then: { properties: { data: repositoryDataSchema } },
        },
        {
          if: { properties: { action: { const: 'register' } } },
          then: { required: ['kind', 'data'] },
        },
        {
          if: { properties: { action: { const: 'update' } } },
          then: { required: ['recordId', 'data'] },
        },
        {
          if: { properties: { action: { const: 'list' } } },
          then: { not: { anyOf: [{ required: ['kind'] }, { required: ['recordId'] }, { required: ['data'] }] } },
        },
      ],
    },
  },
  {
    name: 'list_agents',
    description: 'List the available stack profiles, instruction/skill versions, and persisted default models',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_models',
    description: 'List models available from the live Codex app-server model catalog',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'update_agent_profile',
    description: 'Set the default model and/or supported reasoning effort for a built-in stack profile',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['backend-nestjs', 'frontend-angular'] },
        model: { type: 'string', minLength: 1, maxLength: 255 },
        defaultReasoningEffort: { type: 'string', minLength: 1, maxLength: 40 },
      },
      required: ['role'],
      anyOf: [{ required: ['model'] }, { required: ['defaultReasoningEffort'] }],
      additionalProperties: false,
    },
  },
  {
    name: 'get_project_context',
    description: 'Read project instructions, registered apps and confirmed project memory',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string', format: 'uuid' } },
      required: ['projectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_project_context',
    description: 'Create or update a project instruction or memory record with provenance',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', format: 'uuid' },
        kind: { type: 'string', enum: ['instruction', 'memory'] },
        recordId: { type: 'string', format: 'uuid' },
        data: contextDataSchema,
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
      properties: {
        projectId: { type: 'string', format: 'uuid' },
        request: { type: 'string', minLength: 1, maxLength: 20000 },
      },
      required: ['projectId', 'request'],
    },
  },
  {
    name: 'get_analysis_results',
    description: 'Read saved analysis results, agent messages and session IDs',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string', format: 'uuid' } }, required: ['taskId'] },
  },
  {
    name: 'save_plan',
    description: 'Save or replace a draft plan after discussion of analysis results',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string', format: 'uuid' }, plan: taskPlanSchema },
      required: ['taskId', 'plan'],
    },
  },
  {
    name: 'approve_plan',
    description: 'Persist the final plan after the user explicitly confirms it',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string', format: 'uuid' }, plan: taskPlanSchema, userConfirmed: { const: true } },
      required: ['taskId', 'plan', 'userConfirmed'],
    },
  },
  {
    name: 'execute_task',
    description: 'Execute an explicitly approved dependency plan in new Codex threads and local Git branches',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string', format: 'uuid' } }, required: ['taskId'] },
  },
  {
    name: 'get_task_status',
    description: 'Get task, subtask, Codex session and reconnect state',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string', format: 'uuid' } }, required: ['taskId'] },
  },
  {
    name: 'get_agent_messages',
    description: 'Read agent questions, streamed messages and user replies',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string', format: 'uuid' } }, required: ['taskId'] },
  },
  {
    name: 'send_agent_message',
    description: 'Answer an agent question or send additional direction to a managed thread',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', format: 'uuid' },
        sessionId: { type: 'string', format: 'uuid' },
        message: { type: 'string' },
        questionMessageId: { type: 'string', format: 'uuid' },
        answers: { type: 'object', additionalProperties: { type: 'array', minItems: 1, items: { type: 'string' } } },
      },
      required: ['taskId', 'sessionId'],
      oneOf: [
        { required: ['message'], not: { required: ['questionMessageId'] } },
        { required: ['questionMessageId', 'answers'], not: { required: ['message'] } },
      ],
    },
  },
  {
    name: 'cancel_task',
    description: 'Interrupt active task turns while keeping saved task history',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string', format: 'uuid' } }, required: ['taskId'] },
  },
  {
    name: 'get_task_results',
    description: 'Return Codex results, local branches, changed files and checks',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string', format: 'uuid' } }, required: ['taskId'] },
  },
  {
    name: 'backup_database',
    description:
      'Upload a consistent MySQL backup to the configured remote S3 bucket and optionally verify an isolated restore',
    inputSchema: { type: 'object', properties: { verifyRestore: { type: 'boolean' } } },
  },
  {
    name: 'get_backup_status',
    description: 'List backup/restore operation journal records',
    inputSchema: { type: 'object', properties: {} },
  },
];

for (const tool of tools) tool.inputSchema.additionalProperties ??= false;

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
  async handle(@Body() message: McpRequestDto, @Res() response: Response) {
    const send = (payload: Record<string, any>) => response.status(200).json(payload);
    const id = message.id ?? null;
    if (message.id !== undefined && message.id !== null && !['string', 'number'].includes(typeof message.id)) {
      return send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid JSON-RPC id' } });
    }
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
      const name = message.params?.name;
      const rawArgs = message.params?.arguments;
      try {
        if (typeof name !== 'string') throw new BadRequestException('Tool name must be a string');
        if (rawArgs !== undefined && (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)))
          throw new BadRequestException('Tool arguments must be an object');
        const args = (rawArgs || {}) as Record<string, any>;
        const result = await this.callTool(name, await this.validateToolArgs(name, args));
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

  private async validateToolArgs(name: string, args: Record<string, any>): Promise<Record<string, any>> {
    const dtoByTool: Record<string, new () => object> = {
      manager_status: EmptyToolArgumentsDto,
      list_projects: EmptyToolArgumentsDto,
      register_project: RegisterProjectDto,
      update_project: UpdateProjectDto,
      delete_project: DeleteProjectDto,
      manage_applications: ManageApplicationsDto,
      list_agents: EmptyToolArgumentsDto,
      list_models: EmptyToolArgumentsDto,
      update_agent_profile: UpdateAgentProfileDto,
      get_project_context: ProjectContextQueryDto,
      update_project_context: UpdateProjectContextDto,
      analyze_task: AnalyzeTaskDto,
      get_analysis_results: TaskIdDto,
      save_plan: SavePlanDto,
      approve_plan: ApprovePlanDto,
      execute_task: TaskIdDto,
      get_task_status: TaskIdDto,
      get_agent_messages: TaskIdDto,
      send_agent_message: SendAgentMessageDto,
      cancel_task: TaskIdDto,
      get_task_results: TaskIdDto,
      backup_database: CreateBackupDto,
      get_backup_status: EmptyToolArgumentsDto,
    };
    const dtoType = dtoByTool[name];
    if (!dtoType) return args;
    const dto = plainToInstance(dtoType, args);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true });
    if (errors.length) {
      const details = this.validationMessages(errors);
      throw new BadRequestException(details.join('; ') || 'Invalid MCP tool arguments');
    }
    return dto as Record<string, any>;
  }

  private validationMessages(errors: ValidationError[]): string[] {
    return errors.flatMap((error) => [
      ...Object.values(error.constraints || {}),
      ...this.validationMessages(error.children || []),
    ]);
  }

  private async callTool(name: string, args: Record<string, any>): Promise<unknown> {
    switch (name) {
      case 'manager_status':
        return {
          manager: 'ok',
          database: await this.manager.databaseStatus(),
          appServer: await this.codex.status(),
          backupStorage: await this.backup.storageStatus(),
        };
      case 'list_projects':
        return this.projects.list();
      case 'register_project':
        return this.projects.register(args as unknown as RegisterProjectDto);
      case 'update_project':
        return this.projects.update(args.projectId, args.data);
      case 'delete_project':
        return this.projects.remove(args.projectId);
      case 'manage_applications':
        return this.applications.manage(args as unknown as ManageApplicationsDto);
      case 'list_agents':
        return this.profiles.list();
      case 'list_models':
        return this.codex.listModels();
      case 'update_agent_profile': {
        const input = args as UpdateAgentProfileDto;
        return this.profiles.updateDefaultModel(input.role, input.model, input.defaultReasoningEffort);
      }
      case 'get_project_context':
        return this.manager.getProjectContext(args.projectId);
      case 'update_project_context': {
        if (!['instruction', 'memory'].includes(args.kind))
          throw new Error('Only instruction or memory records may be changed here');
        return this.memory.update(args as unknown as UpdateProjectContextDto);
      }
      case 'analyze_task':
        return this.tasks.analyze(args.projectId, args.request);
      case 'get_analysis_results':
        return this.tasks.analysis(args.taskId);
      case 'save_plan':
        return this.tasks.draft(args.taskId, args.plan as TaskPlanDto);
      case 'approve_plan': {
        if (args.userConfirmed !== true) throw new Error('The user must explicitly confirm the plan before approval');
        return this.tasks.approve(args.taskId, args.plan as TaskPlanDto, true);
      }
      case 'execute_task':
        return this.tasks.execute(args.taskId);
      case 'get_task_status':
        return this.tasks.status(args.taskId);
      case 'get_agent_messages':
        return this.tasks.messages(args.taskId);
      case 'send_agent_message':
        return this.tasks.sendMessage(args as SendAgentMessageDto);
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
