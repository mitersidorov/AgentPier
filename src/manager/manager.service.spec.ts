import { BadRequestException } from '@nestjs/common';
import { ManagerService } from './manager.service';

describe('ManagerService workflow safeguards', () => {
  const task = {
    id: 'task-1',
    kind: 'task',
    projectId: 'project-1',
    name: 'request',
    data: { originalRequest: 'Keep the exact request' },
  };
  const records = {
    findOneBy: jest.fn().mockResolvedValue(task),
    save: jest.fn(async (record) => record),
    create: jest.fn((record) => record),
    find: jest.fn().mockResolvedValue([]),
    exist: jest.fn().mockResolvedValue(true),
  };
  const service = new ManagerService(records as any);

  beforeEach(() => jest.clearAllMocks());

  it('rejects plan approval without an explicit user confirmation', async () => {
    await expect(service.approvePlan('task-1', { steps: [] })).rejects.toBeInstanceOf(BadRequestException);
    expect(records.save).not.toHaveBeenCalled();
  });

  it('preserves an explicitly approved plan separately on the task', async () => {
    const plan = { explicitlyConfirmed: true, steps: ['Implement API'] };
    await service.approvePlan('task-1', plan);
    expect(task.data).toMatchObject({
      originalRequest: 'Keep the exact request',
      approvedPlan: plan,
      status: 'approved',
    });
  });

  it('rejects credential-like fields from persisted domain records', async () => {
    await expect(service.create('memory', { name: 'context', apiKey: 'not-a-real-key' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(records.save).not.toHaveBeenCalled();
  });
});
