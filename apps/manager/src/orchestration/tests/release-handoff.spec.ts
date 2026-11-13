import { EventEmitter } from 'node:events';
jest.mock('../../backup/services/backup.service', () => ({ BackupService: class BackupService {} }));
import { TaskOrchestratorService } from '../services/task-orchestrator.service';
describe('release handoff', () => {
  const runStep = async (targetBranch: string, releaseOperations?: any[]) => {
    const task = { id: 'task-12345678', kind: 'task', projectId: 'project-1', data: { originalRequest: 'request' } };
    const subtask = { id: 'subtask-1', data: {} };
    const records = {
      get: jest.fn().mockResolvedValue(task),
      update: jest.fn().mockResolvedValue(subtask),
      getProjectContext: jest.fn().mockResolvedValue({
        project: { data: {} },
        applications: [],
        repositories: [],
        instructions: [],
        confirmedMemory: [],
      }),
      create: jest.fn().mockResolvedValue({ id: 'session-1', data: {} }),
    };
    const codex = {
      events: new EventEmitter(),
      runCommand: jest
        .fn()
        .mockResolvedValueOnce('feature/work')
        .mockResolvedValueOnce(' M file.ts')
        .mockResolvedValueOnce(' M file.ts')
        .mockResolvedValueOnce('diff stat'),
      startThread: jest.fn().mockResolvedValue({ threadId: 'thread-1', sessionId: 'codex-1', instructionSources: [] }),
      startTurn: jest.fn().mockResolvedValue({ turnId: 'turn-1' }),
    };
    const profiles = {
      resolveRuntime: jest.fn().mockResolvedValue({ model: 'backend-model', effort: 'medium' }),
      load: jest.fn().mockResolvedValue({ profile: '', skills: [], version: 'v1', defaultModel: 'backend-model' }),
    };
    const service = new TaskOrchestratorService(records as any, profiles as any, codex as any, {} as any, {} as any);
    (service as any).terminalTurns.set('turn-1', { turn: { status: 'completed', items: [] } });
    await (service as any).executeStep(
      task.id,
      task.projectId,
      {
        id: 'step-1',
        title: 'change',
        description: 'change it',
        targetBranch,
        releaseOperations,
        dependsOn: ['declared'],
      },
      subtask,
      process.cwd(),
      { declared: 'contract '.repeat(1000), unrelated: 'must-not-leak' },
    );
    return { codex, records };
  };

  it('keeps ordinary steps unpublished and grants only explicit approved operations', async () => {
    const ordinary = await runStep('feature/work');
    expect(ordinary.codex.startThread.mock.calls[0][0].developerInstructions).toContain(
      'Do not push, commit, open PRs, submit reviews, or merge.',
    );
    expect(ordinary.codex.startTurn.mock.calls[0][0].releaseOperations).toBeUndefined();
    const operations = [{ type: 'push', remote: 'origin', ref: 'feature/work' }];
    const release = await runStep('feature/work', operations);
    const instructions = release.codex.startThread.mock.calls[0][0].developerInstructions;
    expect(instructions).toContain('Explicitly approved release operations (only these targets):');
    expect(instructions).toContain(JSON.stringify(operations));
    expect(release.codex.startTurn.mock.calls[0][0].releaseOperations).toEqual(operations);
    expect(release.records.create).toHaveBeenCalledWith(
      'session',
      expect.objectContaining({ releaseOperations: operations }),
      'project-1',
    );
  });
});
