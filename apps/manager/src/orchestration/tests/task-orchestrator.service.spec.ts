import { Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
jest.mock('../../backup/services/backup.service', () => ({ BackupService: class BackupService {} }));
import { TaskOrchestratorService } from '../services/task-orchestrator.service';

describe('TaskOrchestratorService notifications', () => {
  const makeEventHarness = (sessionData = {}) => {
    const session = {
      id: 'session-1',
      projectId: 'project-1',
      data: { threadId: 'thread-1', taskId: 'task-1', status: 'running', ...sessionData },
    };
    const persisted: Array<{ kind: string; data: any }> = [];
    const records = {
      list: jest.fn().mockResolvedValue([session]),
      create: jest.fn(async (kind: string, data: any) => {
        persisted.push({ kind, data });
        return { id: `${kind}-${persisted.length}`, data };
      }),
      update: jest.fn().mockResolvedValue(undefined),
      updateTask: jest.fn().mockResolvedValue(undefined),
    };
    const service = new TaskOrchestratorService(
      records as any,
      {} as any,
      { events: new EventEmitter() } as any,
      { createBackup: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
    );
    return { session, persisted, records, service };
  };

  it('keeps the process alive when an app-server notification cannot be persisted', async () => {
    const events = new EventEmitter();
    const session = {
      id: 'session-1',
      projectId: 'project-1',
      data: { threadId: 'thread-1', status: 'completed' },
    };
    const records = {
      list: jest.fn().mockResolvedValue([session]),
      create: jest.fn().mockRejectedValue(new Error('sensitive event payload')),
      update: jest.fn(),
    };
    const codex = { events };
    const service = new TaskOrchestratorService(records as any, {} as any, codex as any, {} as any, {} as any);
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    await service.onModuleInit();
    events.emit('notification', {
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-1', delta: 'sensitive event payload' },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(log).toHaveBeenCalledWith('Failed to process a Codex app-server notification');
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('sensitive event payload'));
    log.mockRestore();
  });

  it('processes turn/error and completes waiters safely when event journaling fails', async () => {
    const turnId = 'turn-1';
    const session = {
      id: 'session-1',
      projectId: 'project-1',
      data: { threadId: 'thread-1', turnId, taskId: 'task-1', phase: 'execution', status: 'running' },
    };
    const records = {
      list: jest.fn().mockResolvedValue([session]),
      create: jest.fn().mockRejectedValue(new Error('journal unavailable')),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const service = new TaskOrchestratorService(
      records as any,
      {} as any,
      { events: new EventEmitter() } as any,
      {} as any,
      {} as any,
    );
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const resolveTurn = jest.fn();
    (service as any).waiters.set(turnId, [resolveTurn]);

    await (service as any).handleCodexEvent({
      method: 'turn/error',
      params: { threadId: 'thread-1', turnId, error: { message: 'failed with sk-12345678901234567890' } },
    });

    expect(session.data.status).toBe('failed');
    expect(session.data.error.message).toContain('[REDACTED]');
    expect(JSON.stringify(session.data)).not.toContain('sk-12345678901234567890');
    expect(resolveTurn).toHaveBeenCalledWith({
      turn: expect.objectContaining({ id: turnId, status: 'failed' }),
    });
    expect(warning).toHaveBeenCalledWith('Failed to persist a Codex app-server event');
    expect(warning).not.toHaveBeenCalledWith(expect.stringContaining('sk-12345678901234567890'));
    warning.mockRestore();
  });

  it('redacts credentials from persisted orchestration errors', async () => {
    const service = new TaskOrchestratorService({} as any, {} as any, {} as any, {} as any, {} as any);
    expect((service as any).errorMessage(new Error('request failed token=topsecret'))).toBe(
      'request failed token=[REDACTED]',
    );
  });

  it('persists useful agent-message deltas while redacting nested private keys', async () => {
    const { persisted, records, service } = makeEventHarness();
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const privateKey = '-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----';

    await (service as any).handleCodexEvent({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-1',
        delta: 'Reviewed the requested module.',
        metadata: { provider: { privateKey }, apiToken: 'ghp_123456789012345678901234567890123456' },
      },
    });

    const event = persisted.find(({ kind }) => kind === 'agent-event')!;
    const message = persisted.find(({ kind }) => kind === 'agent-message')!;
    expect(event.data.params.metadata).toEqual({ provider: {} });
    expect(event.data.params.apiToken).toBeUndefined();
    expect(message.data).toMatchObject({
      taskId: 'task-1',
      sessionId: 'session-1',
      threadId: 'thread-1',
      kind: 'delta',
      text: 'Reviewed the requested module.',
      status: 'streaming',
    });
    expect(JSON.stringify(persisted)).not.toContain('private-material');
    expect(JSON.stringify(persisted)).not.toContain('ghp_123456789012345678901234567890123456');
    expect(warning).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    warning.mockRestore();
    error.mockRestore();
    expect(records.create).toHaveBeenCalledTimes(2);
  });

  it('stores safe user questions and transitions the session to waiting_for_user', async () => {
    const { session, persisted, records, service } = makeEventHarness();
    const privateKey = '-----BEGIN PRIVATE KEY-----\nsecret-question-key\n-----END PRIVATE KEY-----';

    await (service as any).handleCodexEvent({
      id: 42,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-1',
        questions: [{ id: 'q1', prompt: 'Which test command should I run?', metadata: { privateKey } }],
      },
    });

    const message = persisted.find(({ kind }) => kind === 'agent-message')!;
    expect(message.data).toMatchObject({
      taskId: 'task-1',
      sessionId: 'session-1',
      threadId: 'thread-1',
      serverRequestId: 42,
      kind: 'question',
      questions: [{ id: 'q1', prompt: 'Which test command should I run?', metadata: {} }],
      status: 'pending',
    });
    expect(session.data.status).toBe('waiting_for_user');
    expect(records.update).toHaveBeenCalledWith('session-1', session.data);
    expect(JSON.stringify(persisted)).not.toContain('secret-question-key');
  });

  it('records successful turn completion and resolves waiters with a sanitized result', async () => {
    const { session, persisted, records, service } = makeEventHarness({ phase: 'execution', turnId: 'turn-1' });
    const privateKey = '-----BEGIN PRIVATE KEY-----\nturn-private-key\n-----END PRIVATE KEY-----';
    const resolveTurn = jest.fn();
    (service as any).waiters.set('turn-1', [resolveTurn]);

    await (service as any).handleCodexEvent({
      method: 'turn/completed',
      params: {
        threadId: 'thread-1',
        turn: {
          id: 'turn-1',
          status: 'completed',
          items: [
            { type: 'agentMessage', text: 'Implementation review completed; token=do-not-store' },
            { type: 'metadata', credentials: { privateKey } },
          ],
        },
      },
    });

    expect(session.data).toMatchObject({
      status: 'completed',
      result: 'Implementation review completed; token=[REDACTED]',
    });
    expect(records.update).toHaveBeenCalledWith('session-1', session.data);
    expect(resolveTurn).toHaveBeenCalledWith({
      turn: expect.objectContaining({ id: 'turn-1', status: 'completed' }),
    });
    expect(JSON.stringify(persisted)).not.toContain('do-not-store');
    expect(JSON.stringify(persisted)).not.toContain('turn-private-key');
    expect(JSON.stringify((service as any).terminalTurns.get('turn-1'))).not.toContain('turn-private-key');
  });
});

describe('TaskOrchestratorService branch policy', () => {
  const runStep = async (targetBranch: string) => {
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
      { id: 'step-1', title: 'change', description: 'change it', targetBranch, dependsOn: ['declared'] },
      subtask,
      process.cwd(),
      { declared: 'contract '.repeat(1000), unrelated: 'must-not-leak' },
    );
    return { codex, records };
  };

  it('uses the explicitly selected active branch without switching or creating a branch', async () => {
    const { codex, records } = await runStep('feature/work');

    expect(codex.runCommand).toHaveBeenCalledWith(process.cwd(), ['git', 'branch', '--show-current']);
    expect(records.update).toHaveBeenCalledWith('subtask-1', expect.objectContaining({ branch: 'feature/work' }));
    expect(codex.startThread).toHaveBeenCalledWith(expect.objectContaining({ model: 'backend-model' }));
    expect(codex.startTurn).toHaveBeenCalledWith(expect.objectContaining({ model: 'backend-model', effort: 'medium' }));
    const prompt = codex.startTurn.mock.calls[0][0].prompt;
    expect(prompt).not.toContain('must-not-leak');
    expect(prompt).toContain('"stepId":"declared"');
    expect(prompt).toContain('"truncated":true');
    expect(prompt.length).toBeLessThan(5000);
    expect(records.create).toHaveBeenCalledWith(
      'session',
      expect.objectContaining({
        effectiveModel: 'backend-model',
        effectiveReasoningEffort: 'medium',
        selectedSkills: [],
      }),
      'project-1',
    );
  });

  it('refuses to execute when the explicitly requested branch is not already checked out', async () => {
    await expect(runStep('feature/another')).rejects.toThrow(/AgentPier will not switch branches/);
  });

  it('requires an explicit target branch instead of inferring or creating one', () => {
    const service = new TaskOrchestratorService({} as any, {} as any, {} as any, {} as any, {} as any);
    expect(() =>
      (service as any).normalizeSteps([{ title: 'change', description: 'change it' }], new Set(['backend-nestjs'])),
    ).toThrow(/Ask the user which branch to use and wait/);
  });
});

describe('TaskOrchestratorService project instruction context', () => {
  it('injects confirmed instruction records without legacy project instruction metadata', () => {
    const service = new TaskOrchestratorService({} as any, {} as any, {} as any, {} as any, {} as any);
    const promptContext = (service as any).contextText({
      project: { data: { name: 'AgentPier', instructions: 'legacy text', constraints: 'legacy constraint' } },
      instructions: [
        { id: 'architecture-1', data: { title: 'Architecture', category: 'architecture', content: 'Use NestJS.' } },
      ],
      confirmedMemory: [],
      applications: [],
      repositories: [],
    });
    expect(promptContext).toContain('Use NestJS.');
    expect(promptContext).not.toContain('legacy text');
    expect(promptContext).not.toContain('legacy constraint');
  });
});

describe('TaskOrchestratorService runtime evidence', () => {
  it('passes resolved effort on fresh read-only analysis and persists the effective runtime', async () => {
    const task = { id: 'task', kind: 'task', data: { originalRequest: 'Inspect service' } };
    const records = {
      get: jest.fn().mockResolvedValue(task),
      create: jest.fn(async (_kind, data) => ({ id: 'session', data })),
      update: jest.fn(),
      updateTask: jest.fn(),
    };
    const profiles = {
      load: jest.fn().mockResolvedValue({
        profile: 'profile',
        skills: [],
        version: 'v1',
        defaultModel: null,
        defaultReasoningEffort: 'medium',
      }),
      resolveRuntime: jest.fn().mockResolvedValue({ model: 'live-default', effort: 'medium' }),
    };
    const codex = {
      startThread: jest.fn().mockResolvedValue({ threadId: 'fresh', model: 'live-default' }),
      startTurn: jest.fn().mockResolvedValue({ turnId: 'turn' }),
    };
    const service = new TaskOrchestratorService(records as any, profiles as any, codex as any, {} as any, {} as any);
    await (service as any).runAnalysis('task', {
      project: { id: 'project', data: {} },
      applications: [{ id: 'app', data: { name: 'Manager', path: '/repo' } }],
      instructions: [],
      repositories: [],
      confirmedMemory: [],
    });
    expect(codex.startThread).toHaveBeenCalledWith(expect.objectContaining({ mode: 'read-only' }));
    expect(codex.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'live-default', effort: 'medium', mode: 'read-only' }),
    );
    expect(records.create).toHaveBeenCalledWith(
      'session',
      expect.objectContaining({ effectiveModel: 'live-default', effectiveReasoningEffort: 'medium' }),
      'project',
    );
  });

  it('pins continued user turns to session model/effort instead of changed profile defaults', async () => {
    const session = {
      id: 'session',
      kind: 'session',
      data: { taskId: 'task', threadId: 'thread', effectiveModel: 'pinned', effectiveReasoningEffort: 'high' },
    };
    const records = {
      get: jest.fn().mockResolvedValueOnce({ kind: 'task' }).mockResolvedValueOnce(session),
      update: jest.fn(),
      create: jest.fn(),
    };
    const profiles = { resolveRuntime: jest.fn().mockResolvedValue({ model: 'pinned', effort: 'high' }) };
    const codex = { sendMessage: jest.fn().mockResolvedValue({ turn: { id: 'continued' } }) };
    const service = new TaskOrchestratorService(records as any, profiles as any, codex as any, {} as any, {} as any);
    await service.sendMessage({ taskId: 'task', sessionId: 'session', message: 'Continue' });
    expect(profiles.resolveRuntime).toHaveBeenCalledWith({ defaultModel: 'pinned', defaultReasoningEffort: 'high' });
    expect(codex.sendMessage).toHaveBeenCalledWith('thread', 'Continue', { model: 'pinned', effort: 'high' });
    expect(records.update).toHaveBeenCalledWith(
      'session',
      expect.objectContaining({ effectiveModel: 'pinned', effectiveReasoningEffort: 'high', turnId: 'continued' }),
    );
  });
});
