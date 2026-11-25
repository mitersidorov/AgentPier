jest.mock('../../backup/services/backup.service', () => ({ BackupService: class BackupService {} }));

import { McpController } from '../controllers/mcp.controller';
import { TaskService } from '../../tasks/services/task.service';
import { TaskOrchestratorService } from '../../orchestration/services/task-orchestrator.service';

describe('MCP focused tool behavior', () => {
  const projectId = '00000000-0000-4000-8000-000000000001';
  const taskId = '00000000-0000-4000-8000-000000000002';
  const subtaskId = '00000000-0000-4000-8000-000000000003';
  const applications = { manage: jest.fn() };
  const backup = { createBackup: jest.fn(), status: jest.fn() };
  const tasks = {
    approve: jest.fn().mockResolvedValue({ approved: true }),
    completeFromEvidence: jest.fn().mockResolvedValue({ completed: true }),
    dispatchAssignment: jest.fn().mockResolvedValue({ taskId, subtaskId, status: 'running' }),
    cancel: jest.fn().mockResolvedValue({ id: taskId, data: { status: 'cancelled' } }),
  };

  const controller = new McpController(
    {} as any,
    {} as any,
    {} as any,
    backup as any,
    {} as any,
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

  it('returns an MCP tool error for invalid arguments without invoking the service', async () => {
    const result = await call('dispatch_orchestration_assignment', { taskId, stepId: '', dependencies: [] });

    expect(result).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { isError: true, content: [{ type: 'text' }] },
    });
    expect(result.result.content[0].text).toMatch(/stepId must be longer than or equal to 1 characters/);
    expect(tasks.dispatchAssignment).not.toHaveBeenCalled();
  });

  it('keeps mixed application management modes distinct at the boundary', async () => {
    applications.manage.mockResolvedValue({ applications: [], repositories: [] });
    await call('manage_applications', { action: 'list', projectId });
    expect(applications.manage).toHaveBeenCalledWith({ action: 'list', projectId });

    applications.manage.mockResolvedValue({ id: 'repository-id' });
    await call('manage_applications', {
      action: 'register',
      projectId,
      kind: 'repository',
      data: { name: 'repo', path: '/tmp/repo', remoteUrl: 'https://example.test/repo' },
    });
    expect(applications.manage).toHaveBeenLastCalledWith({
      action: 'register',
      projectId,
      kind: 'repository',
      data: { name: 'repo', path: '/tmp/repo', remoteUrl: 'https://example.test/repo' },
    });
  });

  it('enforces explicit approval and forwards recovery, cancellation, and dispatch', async () => {
    const plan = {
      steps: [{ title: 'Run checks', description: 'Run focused checks', workingDirectory: 'application' }],
    };
    const rejected = await call('approve_plan', { taskId, plan, userConfirmed: false });
    expect(rejected.result.isError).toBe(true);
    expect(tasks.approve).not.toHaveBeenCalled();

    const approved = await call('approve_plan', { taskId, plan, userConfirmed: true });
    expect(approved.result.isError).toBeUndefined();
    expect(tasks.approve).toHaveBeenCalledWith(taskId, plan, true);

    await call('dispatch_orchestration_assignment', { taskId, stepId: 'step-a', dependencies: { note: 'retry' } });
    expect(tasks.dispatchAssignment).toHaveBeenCalledWith(taskId, 'step-a', { note: 'retry' });
    await call('complete_task_from_evidence', {
      taskId,
      subtaskId,
      result: 'Recovered',
      evidence: ['focused test passed'],
      userConfirmed: true,
    });
    expect(tasks.completeFromEvidence).toHaveBeenCalledWith(
      taskId,
      subtaskId,
      'Recovered',
      ['focused test passed'],
      true,
    );
    await call('cancel_task', { taskId });
    expect(tasks.cancel).toHaveBeenCalledWith(taskId);
  });

  it('passes the restore option through the backup boundary and rejects non-boolean values', async () => {
    backup.createBackup.mockResolvedValue({
      data: { status: 'succeeded', prunedObjects: 2, restore: { verified: true } },
    });
    const verified = await call('backup_database', { verifyRestore: true });
    expect(verified.result.isError).toBeUndefined();
    expect(backup.createBackup).toHaveBeenCalledWith('manual-verified', true);
    expect(JSON.parse(verified.result.content[0].text).data).toMatchObject({
      prunedObjects: 2,
      restore: { verified: true },
    });

    const invalid = await call('backup_database', { verifyRestore: 'yes' });
    expect(invalid.result.isError).toBe(true);
    expect(backup.createBackup).toHaveBeenCalledTimes(1);
  });

  it('reconnects an unattached running session when get_task_status is requested', async () => {
    const task = { id: taskId, kind: 'task', projectId, data: {} };
    const session = {
      id: '00000000-0000-4000-8000-000000000004',
      data: { taskId, status: 'running', attached: false, threadId: 'thread-1' },
    };
    const records = { get: jest.fn().mockResolvedValue(task), list: jest.fn().mockResolvedValue([]) };
    const sessionRecords = { forTask: jest.fn().mockResolvedValue([session]) };
    const codex = { resumeThread: jest.fn().mockResolvedValue({}) };
    const coordinator = { handleEvent: jest.fn(), updateSession: jest.fn().mockResolvedValue(undefined) };
    const orchestration = new TaskOrchestratorService(
      records as any,
      {} as any,
      codex as any,
      sessionRecords as any,
      coordinator as any,
    );
    const originalTasks = (controller as any).tasks;
    (controller as any).tasks = new TaskService({} as any, orchestration);

    const result = await call('get_task_status', { taskId });

    expect(result.result.isError).toBeUndefined();
    expect(codex.resumeThread).toHaveBeenCalledWith('thread-1');
    expect(coordinator.updateSession).toHaveBeenCalledWith(session.id, {
      ...session.data,
      attached: true,
    });
    expect(JSON.parse(result.result.content[0].text).sessions[0].data.attached).toBe(true);
    (controller as any).tasks = originalTasks;
  });
});
