import { ApprovedPlanExecutionService } from '../services/approved-plan-execution.service';

describe('ApprovedPlanExecutionService', () => {
  const makeHarness = (status = 'executing') => {
    const records = [
      { id: 'a', data: { id: 'a', dependsOn: [], result: null } },
      { id: 'b', data: { id: 'b', dependsOn: ['a'], result: null } },
      { id: 'c', data: { id: 'c', dependsOn: [], result: null } },
    ];
    const steps: any[] = [
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: [] },
    ];
    const completed = new Set<string>();
    const starts: string[] = [];
    const port = {
      requireTask: jest.fn(async () => ({ projectId: 'p', data: { status } })),
      stepRepoPath: jest.fn(async (_project: string, step: any) => `/repo/${step.id}`),
      assertNoActivePathSessions: jest.fn(),
      isReusableSuccess: jest.fn((record: any) => completed.has(record.data.id)),
      executeStep: jest.fn(async (_task: string, _project: string, step: any) => {
        starts.push(step.id);
        if (step.id === 'a' || step.id === 'c') await new Promise((resolve) => setTimeout(resolve, 5));
        if (step.id === 'b' && !completed.has('a')) throw new Error('dependency ran early');
        completed.add(step.id);
        return `result-${step.id}`;
      }),
      updateTask: jest.fn(),
      createBackup: jest.fn(),
    };
    return { records, steps, port, starts };
  };

  it('schedules ready steps concurrently and starts dependents only after success', async () => {
    const service = new ApprovedPlanExecutionService();
    const { records, steps, port, starts } = makeHarness();
    await service.executeGraph('task', steps, records, port as any);
    expect(starts.slice(0, 2)).toEqual(expect.arrayContaining(['a', 'c']));
    expect(starts.indexOf('b')).toBeGreaterThan(Math.max(starts.indexOf('a'), starts.indexOf('c')));
    expect(port.updateTask).toHaveBeenCalledWith('task', expect.objectContaining({ status: 'review_ready' }));
    expect(port.createBackup).toHaveBeenCalledWith('milestone');
  });

  it('leaves cancelled tasks without finalization or backup', async () => {
    const service = new ApprovedPlanExecutionService();
    const { records, steps, port } = makeHarness('cancelled');
    await service.executeGraph('task', steps, records, port as any);
    expect(port.executeStep).not.toHaveBeenCalled();
    expect(port.updateTask).not.toHaveBeenCalled();
    expect(port.createBackup).not.toHaveBeenCalled();
  });

  it('rejects cyclic or unresolved dependency graphs', async () => {
    const service = new ApprovedPlanExecutionService();
    const { records, port } = makeHarness();
    await expect(
      service.executeGraph('task', [{ id: 'a', dependsOn: ['missing'] } as any], records, port as any),
    ).rejects.toThrow(/cycle|unknown/);
  });
});
