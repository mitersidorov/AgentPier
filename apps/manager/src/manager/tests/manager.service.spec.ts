import { BadRequestException } from '@nestjs/common';
import { ManagerService } from '../services/manager.service';

describe('ManagerService workflow safeguards', () => {
  const task = {
    id: 'task-1',
    kind: 'task',
    projectId: 'project-1',
    name: 'request',
    data: { originalRequest: 'Keep the exact request', status: 'analysis_complete' },
  };
  const records = {
    findOneBy: jest.fn().mockResolvedValue(task),
    save: jest.fn(async (record) => record),
    create: jest.fn((record) => record),
    find: jest.fn().mockResolvedValue([]),
    exist: jest.fn().mockResolvedValue(true),
  };
  const service = new ManagerService(records as any);

  beforeEach(() => {
    jest.clearAllMocks();
    task.data.status = 'analysis_complete';
  });

  it('rejects plan approval without an explicit user confirmation', async () => {
    await expect(service.approvePlan('task-1', { steps: [] })).rejects.toBeInstanceOf(BadRequestException);
    expect(records.save).not.toHaveBeenCalled();
  });

  it('preserves an explicitly approved plan separately on the task', async () => {
    const plan = {
      explicitlyConfirmed: true,
      steps: [{ title: 'Implement API', description: 'Document the contract', targetBranch: 'feature/api' }],
    };
    await service.approvePlan('task-1', plan);
    expect(task.data).toMatchObject({
      originalRequest: 'Keep the exact request',
      approvedPlan: plan,
      status: 'approved',
    });
  });

  it('persists explicit typed release scope and rejects malformed operation targets', async () => {
    const plan = {
      explicitlyConfirmed: true,
      steps: [
        {
          title: 'Release',
          description: 'Push selected ref',
          targetBranch: 'feature/work',
          releaseOperations: [{ type: 'push', remote: 'origin', ref: 'feature/work' }],
        },
      ],
    };
    await service.approvePlan('task-1', plan);
    expect(task.data).toMatchObject({ approvedPlan: plan });
    task.data.status = 'analysis_complete';
    await expect(
      service.approvePlan('task-1', { ...plan, steps: [{ ...plan.steps[0], releaseOperations: [{ type: 'push' }] }] }),
    ).rejects.toThrow(/Invalid releaseOperations/);
  });

  it('allows explicit approval after saving a draft plan', async () => {
    const plan = {
      steps: [{ title: 'Implement API', description: 'Document the contract', targetBranch: 'feature/api' }],
    };
    await service.saveDraftPlan('task-1', plan);
    expect(task.data.status).toBe('plan_draft');
    await service.approvePlan('task-1', { ...plan, explicitlyConfirmed: true });
    expect(task.data).toMatchObject({
      status: 'approved',
      draftPlan: plan,
      approvedPlan: { ...plan, explicitlyConfirmed: true },
    });
  });

  it('requires a user-selected branch for every step before plan approval', async () => {
    const plan = {
      explicitlyConfirmed: true,
      steps: [{ title: 'Implement API', description: 'Document the contract' }],
    };
    await expect(service.approvePlan('task-1', plan)).rejects.toThrow(/targetBranch explicitly/i);
    expect(records.save).not.toHaveBeenCalled();
  });

  it('preserves a configured profile model while refreshing seeded profile metadata', async () => {
    const profileRecord = {
      id: 'profile-1',
      kind: 'agent-profile',
      projectId: null,
      name: 'Backend NestJS',
      data: { role: 'backend-nestjs', defaultModel: 'user-selected-model' },
    };
    const profileRepository = {
      find: jest.fn().mockResolvedValue([profileRecord]),
      save: jest.fn(async (record) => record),
      create: jest.fn((record) => record),
      delete: jest.fn(),
    };
    const profileManager = new ManagerService(profileRepository as any);
    await profileManager.seedProfiles([
      {
        role: 'backend-nestjs',
        instructions: 'Updated instructions',
        version: 'new-version',
        defaultModel: 'new-default',
      },
    ]);

    expect(profileRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ defaultModel: 'user-selected-model' }) }),
    );
  });

  it('rejects credential-like fields from persisted domain records', async () => {
    await expect(service.create('memory', { name: 'context', apiKey: 'not-a-real-key' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(records.save).not.toHaveBeenCalled();
  });

  it('returns only confirmed project instructions in launch context', async () => {
    const project = { id: 'project-1', kind: 'project', data: { instructions: 'legacy', constraints: 'legacy-only' } };
    const repository = {
      findOneBy: jest.fn().mockResolvedValue(project),
      find: jest.fn(async ({ where }: any) =>
        where.kind === 'instruction'
          ? [
              { id: 'confirmed', data: { status: 'confirmed', content: 'Architecture' } },
              { id: 'draft', data: { status: 'draft', content: 'Unconfirmed' } },
            ]
          : [],
      ),
    };
    const manager = new ManagerService(repository as any);
    const context = await manager.getProjectContext('project-1');
    expect(context.instructions.map((row: any) => row.id)).toEqual(['confirmed']);
  });
});
