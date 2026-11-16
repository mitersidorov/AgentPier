jest.mock('../../backup/services/backup.service', () => ({ BackupService: class BackupService {} }));

import { McpController } from '../controllers/mcp.controller';
import { TaskService } from '../../tasks/services/task.service';
import { TaskOrchestratorService } from '../../orchestration/services/task-orchestrator.service';

describe('MCP record management tools', () => {
  const projects = { update: jest.fn().mockResolvedValue({ id: 'project-id', updated: true }) };
  const applications = { manage: jest.fn().mockResolvedValue({ id: 'record-id', updated: true }) };
  const tasks = {
    read: jest.fn().mockResolvedValue({ task: { id: 'task-id' }, plan: null }),
    recordDecision: jest.fn().mockResolvedValue({ id: 'task-id' }),
    dispatchAssignment: jest.fn().mockResolvedValue({ taskId: 'task-id', subtaskId: 'subtask-id' }),
    dispatchAnalysis: jest.fn().mockResolvedValue({ taskId: 'task-id', sessionId: 'session-id' }),
    execute: jest.fn().mockResolvedValue({ id: 'task-id', data: { status: 'executing' } }),
    recordAssignmentOutcome: jest.fn().mockResolvedValue({ id: 'subtask-id' }),
  };
  const controller = new McpController(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    projects as any,
    applications as any,
    {} as any,
    tasks as any,
  );

  const call = async (name: string, args: object) => {
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn((value) => value) };
    return controller.handle(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } as any,
      response as any,
    );
  };

  beforeEach(() => jest.clearAllMocks());

  it('advertises update tools and routes valid project edits', async () => {
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn((value) => value) };
    const listing = await controller.handle({ id: 2, method: 'tools/list' } as any, response as any);
    const names = listing.result.tools.map((tool: any) => tool.name);
    expect(names).toContain('update_project');
    expect(names).toContain('manage_applications');

    const result = await call('update_project', {
      projectId: '00000000-0000-4000-8000-000000000001',
      data: { description: 'Updated project' },
    });
    expect(result.result.isError).toBeUndefined();
    expect(projects.update).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001', {
      description: 'Updated project',
    });
  });

  it('routes application and repository updates with their project scope', async () => {
    const result = await call('manage_applications', {
      action: 'update',
      projectId: '00000000-0000-4000-8000-000000000001',
      recordId: '00000000-0000-4000-8000-000000000002',
      kind: 'repository',
      data: { remoteUrl: 'https://example.test/repo' },
    });
    expect(result.result.isError).toBeUndefined();
    expect(applications.manage).toHaveBeenCalledWith({
      action: 'update',
      projectId: '00000000-0000-4000-8000-000000000001',
      recordId: '00000000-0000-4000-8000-000000000002',
      kind: 'repository',
      data: { remoteUrl: 'https://example.test/repo' },
    });
  });

  it('advertises and routes task-scoped read and decision tools with strict validation', async () => {
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn((value) => value) };
    const listing = await controller.handle({ id: 2, method: 'tools/list' } as any, response as any);
    const advertised = listing.result.tools;
    const schemaFor = (name: string) => advertised.find((tool: any) => tool.name === name).inputSchema;
    expect(schemaFor('read_orchestration_task')).toMatchObject({
      required: ['taskId'],
      properties: { taskId: { type: 'string', format: 'uuid' } },
    });
    expect(advertised.find((tool: any) => tool.name === 'record_orchestration_decision').inputSchema.required).toEqual([
      'taskId',
      'decision',
    ]);
    expect(schemaFor('record_orchestration_decision').properties).toMatchObject({
      taskId: { type: 'string', format: 'uuid' },
      decision: { type: 'string', minLength: 1, maxLength: 20000 },
    });
    expect(schemaFor('dispatch_orchestration_assignment')).toMatchObject({
      required: ['taskId', 'stepId', 'dependencies'],
      properties: {
        taskId: { type: 'string', format: 'uuid' },
        stepId: { type: 'string', minLength: 1, maxLength: 255 },
        dependencies: { type: 'object' },
      },
    });
    expect(schemaFor('record_assignment_outcome')).toMatchObject({
      required: ['taskId', 'subtaskId', 'status', 'outcome', 'evidence'],
      properties: {
        taskId: { type: 'string', format: 'uuid' },
        subtaskId: { type: 'string', format: 'uuid' },
        status: { type: 'string', enum: ['completed', 'partial', 'blocked'] },
        outcome: { type: 'string', minLength: 1, maxLength: 20000 },
        evidence: { type: 'array' },
      },
    });
    expect(schemaFor('record_orchestration_task_status')).toMatchObject({
      required: ['taskId', 'status', 'decision'],
      properties: {
        taskId: { type: 'string', format: 'uuid' },
        status: {
          type: 'string',
          enum: [
            'pending_action',
            'analysis_running',
            'analysis_complete',
            'plan_draft',
            'approved',
            'executing',
            'review_ready',
            'completed',
            'blocked',
            'cancelled',
          ],
        },
        decision: { type: 'string', minLength: 1, maxLength: 20000 },
      },
    });
    expect(advertised.map((tool: any) => tool.name)).toContain('read_orchestration_task');
    expect(advertised.map((tool: any) => tool.name)).toContain('dispatch_orchestration_assignment');
    expect(schemaFor('dispatch_orchestration_analysis')).toMatchObject({
      required: ['taskId', 'appId', 'profile', 'workingDirectory', 'focus'],
      properties: {
        profile: { type: 'string' },
        appId: { type: 'string', format: 'uuid' },
        workingDirectory: { type: 'string', enum: ['application', 'repository'] },
      },
    });
    expect(advertised.map((tool: any) => tool.name)).toContain('record_assignment_outcome');
    expect(advertised.map((tool: any) => tool.name)).toContain('record_orchestration_task_status');

    const taskId = '00000000-0000-4000-8000-000000000010';
    await call('read_orchestration_task', { taskId });
    expect(tasks.read).toHaveBeenCalledWith(taskId);
    await call('record_orchestration_decision', { taskId, decision: 'Use backend profile' });
    expect(tasks.recordDecision).toHaveBeenCalledWith(taskId, 'Use backend profile');
    await call('dispatch_orchestration_assignment', { taskId, stepId: 'step-a', dependencies: {} });
    expect(tasks.dispatchAssignment).toHaveBeenCalledWith(taskId, 'step-a', {});
    await call('dispatch_orchestration_analysis', {
      taskId,
      appId: '00000000-0000-4000-8000-000000000012',
      profile: 'backend-nestjs',
      workingDirectory: 'application',
      focus: 'Inspect the backend contract',
    });
    expect(tasks.dispatchAnalysis).toHaveBeenCalledWith(expect.objectContaining({ taskId, profile: 'backend-nestjs' }));
    expect(schemaFor('execute_task')).toMatchObject({ required: ['taskId', 'decision'] });
    await call('execute_task', { taskId, decision: 'Begin the selected plan' });
    expect(tasks.execute).toHaveBeenCalledWith(taskId, 'Begin the selected plan');
    await call('record_assignment_outcome', {
      taskId,
      subtaskId: '00000000-0000-4000-8000-000000000011',
      status: 'completed',
      outcome: 'Checks passed',
      evidence: ['Jest passed'],
    });
    expect(tasks.recordAssignmentOutcome).toHaveBeenCalledWith(
      taskId,
      '00000000-0000-4000-8000-000000000011',
      'completed',
      'Checks passed',
      ['Jest passed'],
    );
    const invalid = await call('record_orchestration_decision', { taskId, decision: '', extra: true });
    expect(invalid.result.isError).toBe(true);
    expect(tasks.recordDecision).toHaveBeenCalledTimes(1);
  });

  it('persists an explicit completed status through the MCP outcome tool', async () => {
    const task = {
      id: '00000000-0000-4000-8000-000000000010',
      kind: 'task',
      projectId: 'project',
      data: {
        status: 'blocked',
        approvedPlan: { steps: [{ id: 'step-x' }] },
        subtaskIds: ['00000000-0000-4000-8000-000000000011'],
      },
    };
    const subtaskId = '00000000-0000-4000-8000-000000000011';
    const subtask = {
      id: subtaskId,
      kind: 'subtask',
      projectId: 'project',
      data: { id: 'step-x', taskId: task.id, status: 'blocked' },
    };
    const records = {
      get: jest.fn().mockResolvedValueOnce(task).mockResolvedValueOnce(subtask).mockResolvedValueOnce(task),
      update: jest.fn().mockResolvedValue({ ...subtask, data: { ...subtask.data, status: 'completed' } }),
      updateTask: jest.fn(),
    };
    const orchestration = new TaskOrchestratorService(records as any, {} as any, {} as any, {} as any, {} as any);
    (controller as any).tasks = new TaskService({} as any, orchestration);

    const result = await call('record_assignment_outcome', {
      taskId: task.id,
      subtaskId,
      status: 'completed',
      outcome: 'Worker finished',
      evidence: ['Focused test passed'],
    });

    expect(result.result.isError).toBeUndefined();
    expect(records.update).toHaveBeenCalledWith(subtaskId, expect.objectContaining({ status: 'completed' }));
    expect(records.updateTask).not.toHaveBeenCalled();

    const statusResult = await call('record_orchestration_task_status', {
      taskId: task.id,
      status: 'completed',
      decision: 'LLM reviewed the assignment and completed the task',
    });

    expect(statusResult.result.isError).toBeUndefined();
    expect(records.updateTask).toHaveBeenCalledWith(task.id, {
      status: 'completed',
      statusDecision: 'LLM reviewed the assignment and completed the task',
    });
  });

  it('validates analysis dispatch arguments at the MCP boundary', async () => {
    (controller as any).tasks = tasks;
    const valid = {
      taskId: '00000000-0000-4000-8000-000000000010',
      appId: '00000000-0000-4000-8000-000000000012',
      profile: 'backend-nestjs',
      workingDirectory: 'application',
      focus: 'Inspect backend contracts',
    };

    const missing = await call('dispatch_orchestration_analysis', {
      taskId: valid.taskId,
      appId: valid.appId,
      profile: valid.profile,
      workingDirectory: valid.workingDirectory,
    });
    const invalid = await call('dispatch_orchestration_analysis', { ...valid, workingDirectory: 'root' });
    const uppercaseProfile = await call('dispatch_orchestration_analysis', { ...valid, profile: 'Backend-nestjs' });
    const spacedProfile = await call('dispatch_orchestration_analysis', { ...valid, profile: 'backend nestjs' });
    const extra = await call('dispatch_orchestration_analysis', { ...valid, unexpected: true });

    expect(missing.result.isError).toBe(true);
    expect(invalid.result.isError).toBe(true);
    expect(uppercaseProfile.result.isError).toBe(true);
    expect(spacedProfile.result.isError).toBe(true);
    expect(extra.result.isError).toBe(true);
    expect(tasks.dispatchAnalysis).not.toHaveBeenCalled();

    const accepted = await call('dispatch_orchestration_analysis', valid);
    expect(accepted.result.isError).toBeUndefined();
    expect(tasks.dispatchAnalysis).toHaveBeenCalledWith(expect.objectContaining(valid));
  });
});
