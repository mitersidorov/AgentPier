import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ManagerService } from '../services/manager.service';

describe('ManagerService.deleteProjectCascade', () => {
  const projectId = 'project-1';
  const transactionRecords = {
    findOneBy: jest.fn(),
    delete: jest.fn(),
  };
  const transaction = { getRepository: jest.fn().mockReturnValue(transactionRecords) };
  const records = {
    findOneBy: jest.fn(),
    find: jest.fn(),
    save: jest.fn(async (row) => row),
    manager: { transaction: jest.fn(async (work) => work(transaction)) },
  };
  const codex = { stopTurnAndWait: jest.fn() };
  const service = new ManagerService(records as any, codex as any);

  beforeEach(() => {
    jest.resetAllMocks();
    records.findOneBy.mockResolvedValue({ id: projectId, kind: 'project', data: {} });
    records.find.mockResolvedValue([]);
    records.save.mockImplementation(async (row) => row);
    codex.stopTurnAndWait.mockResolvedValue(undefined);
    transaction.getRepository.mockReturnValue(transactionRecords);
    records.manager.transaction.mockImplementation(async (work) => work(transaction));
    transactionRecords.findOneBy.mockResolvedValue({ id: projectId, kind: 'project' });
    transactionRecords.delete.mockResolvedValueOnce({ affected: 3 }).mockResolvedValueOnce({ affected: 1 });
  });

  it('deletes only records owned by the project inside a transaction', async () => {
    await expect(service.deleteProjectCascade(projectId)).resolves.toEqual({
      deleted: true,
      projectId,
      deletedRecords: 4,
    });
    expect(records.manager.transaction).toHaveBeenCalledTimes(1);
    expect(transactionRecords.delete).toHaveBeenNthCalledWith(1, {
      projectId,
      kind: expect.objectContaining({ _type: 'not' }),
    });
    expect(transactionRecords.delete).toHaveBeenNthCalledWith(2, { id: projectId, kind: 'project' });
  });

  it('rejects missing records and non-project records before deleting anything', async () => {
    records.findOneBy.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: projectId, kind: 'task' });
    await expect(service.deleteProjectCascade(projectId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.deleteProjectCascade(projectId)).rejects.toBeInstanceOf(BadRequestException);
    expect(transactionRecords.delete).not.toHaveBeenCalled();
  });

  it('propagates a dependent deletion error so the transaction can roll back', async () => {
    transactionRecords.delete.mockReset().mockRejectedValueOnce(new Error('delete failed'));
    await expect(service.deleteProjectCascade(projectId)).rejects.toThrow('delete failed');
    expect(records.manager.transaction).toHaveBeenCalledTimes(1);
  });

  it.each(['analysis_running', 'executing', 'execution_running', 'running', 'waiting_for_user'])(
    'waits for external termination before deleting a %s project',
    async (status) => {
      const task = { id: 'task-1', kind: 'task', data: { status } };
      records.find.mockResolvedValue([
        task,
        { kind: 'session', data: { taskId: task.id, status: 'running', threadId: 'thread', turnId: 'turn' } },
      ]);
      records.findOneBy.mockImplementation(async ({ id }) =>
        id === task.id ? task : { id: projectId, kind: 'project' },
      );
      let finish!: () => void;
      codex.stopTurnAndWait.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      const deletion = service.deleteProjectCascade(projectId);
      // Flush preflight record reads and task cancellation, leaving the external boundary pending.
      for (let i = 0; i < 10; i++) await Promise.resolve();
      expect(codex.stopTurnAndWait).toHaveBeenCalledWith('thread', 'turn');
      expect(records.manager.transaction).not.toHaveBeenCalled();
      expect(transactionRecords.delete).not.toHaveBeenCalled();
      finish();
      await expect(deletion).resolves.toMatchObject({ deleted: true });
    },
  );

  it.each(['timeout', 'interrupt error', 'unknown turn state'])(
    'preserves records for a detached turn on %s',
    async (reason) => {
      records.find.mockResolvedValue([
        { kind: 'session', data: { attached: false, status: 'running', threadId: 'thread', turnId: 'turn' } },
      ]);
      codex.stopTurnAndWait.mockRejectedValue(new Error(reason));
      await expect(service.deleteProjectCascade(projectId)).rejects.toThrow(reason);
      expect(records.manager.transaction).not.toHaveBeenCalled();
      expect(transactionRecords.delete).not.toHaveBeenCalled();
    },
  );

  it('verifies locally cancelled turns rather than trusting cancellation acknowledgements', async () => {
    records.find.mockResolvedValue([
      { kind: 'session', data: { attached: false, status: 'cancelled', threadId: 'thread', turnId: 'turn' } },
    ]);
    await service.deleteProjectCascade(projectId);
    expect(codex.stopTurnAndWait).toHaveBeenCalledWith('thread', 'turn');
  });

  it.each([
    [{ kind: 'task', id: 'task-1', data: { status: 'analysis_running' } }],
    [{ kind: 'session', data: { status: 'waiting_for_user', threadId: 'thread' } }],
  ])('preserves records when active work has no verifiable turn: %j', async (...owned) => {
    records.find.mockResolvedValue(owned);
    await expect(service.deleteProjectCascade(projectId)).rejects.toThrow('verifiable');
    expect(transactionRecords.delete).not.toHaveBeenCalled();
  });
  it('keeps the inactive cascade independent of Codex', async () => {
    records.find.mockResolvedValue([
      { kind: 'task', data: { status: 'review_ready' } },
      { kind: 'session', data: { status: 'completed', threadId: 'thread', turnId: 'turn' } },
    ]);
    await expect(service.deleteProjectCascade(projectId)).resolves.toMatchObject({ deleted: true, deletedRecords: 4 });
    expect(codex.stopTurnAndWait).not.toHaveBeenCalled();
  });

  it('does not start the cascade if a later turn cannot be stopped', async () => {
    records.find.mockResolvedValue(
      ['turn-1', 'turn-2'].map((turnId) => ({
        kind: 'session',
        data: { status: 'running', attached: false, threadId: 'thread', turnId },
      })),
    );
    codex.stopTurnAndWait.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('timeout'));
    await expect(service.deleteProjectCascade(projectId)).rejects.toThrow('timeout');
    expect(codex.stopTurnAndWait).toHaveBeenCalledTimes(2);
    expect(transactionRecords.delete).not.toHaveBeenCalled();
  });
});
