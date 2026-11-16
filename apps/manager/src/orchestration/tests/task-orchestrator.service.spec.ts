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
      findSessionByThreadId: jest.fn().mockResolvedValue(session),
      listActiveSessions: jest.fn().mockResolvedValue([]),
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
      findSessionByThreadId: jest.fn().mockResolvedValue(session),
      listActiveSessions: jest.fn().mockResolvedValue([]),
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
      findSessionByThreadId: jest.fn().mockResolvedValue(session),
      listActiveSessions: jest.fn().mockResolvedValue([]),
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
    (service as any).sessionCoordinator.waiters.set(turnId, [resolveTurn]);

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
    expect(records.findSessionByThreadId).toHaveBeenCalledWith('thread-1');
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
    (service as any).sessionCoordinator.waiters.set('turn-1', [resolveTurn]);

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
    expect(JSON.stringify((service as any).sessionCoordinator.terminalTurns.get('turn-1'))).not.toContain(
      'turn-private-key',
    );
  });
});

describe('TaskOrchestratorService selected analysis dispatch', () => {
  it('starts only the requested read-only profile session and returns its stored result to the orchestrator', async () => {
    const task = {
      id: 'task-analysis',
      kind: 'task',
      projectId: 'project-analysis',
      data: { originalRequest: 'Inspect the backend behavior', status: 'pending_action', sessionIds: [] },
    };
    const repository = {
      id: 'repo-analysis',
      kind: 'repository',
      projectId: task.projectId,
      data: { path: '/repo' },
    };
    const application = {
      id: 'app-analysis',
      kind: 'app',
      projectId: task.projectId,
      data: { name: 'Manager', path: '/repo/apps/manager', repositoryId: repository.id },
    };
    const session = {
      id: 'session-analysis',
      kind: 'session',
      projectId: task.projectId,
      data: {} as Record<string, any>,
    };
    const records = {
      findSessionByThreadId: jest.fn().mockResolvedValue(session),
      get: jest.fn(async (id: string) => {
        if (id === task.id) return task;
        if (id === application.id) return application;
        if (id === repository.id) return repository;
        if (id === session.id) return session;
        throw new Error(`Unexpected record ${id}`);
      }),
      create: jest.fn().mockImplementation(async (kind: string, data: any) => {
        if (kind === 'session') {
          session.data = data;
          return session;
        }
        return { id: 'event-id', kind, data };
      }),
      update: jest.fn().mockImplementation(async (_id: string, data: any) => {
        session.data = data;
        return session;
      }),
      updateTask: jest.fn().mockImplementation(async (_id: string, patch: any) => {
        task.data = { ...task.data, ...patch };
        return task;
      }),
      getProjectContext: jest.fn().mockResolvedValue({
        project: { id: task.projectId, data: { name: 'AgentPier' } },
        instructions: [],
        confirmedMemory: [],
        applications: [application],
        repositories: [repository],
      }),
    };
    const selectedSkill = {
      path: '/agents/backend-nestjs/skills/backend-review-checklist/SKILL.md',
      content: 'Review',
    };
    const profile = {
      role: 'backend-nestjs',
      profile: 'Backend profile instructions',
      skills: [
        selectedSkill,
        { path: '/agents/backend-nestjs/skills/minimal-test-strategy/SKILL.md', content: 'Tests' },
      ],
      version: 'profile-v1',
      defaultModel: 'backend-model',
      defaultReasoningEffort: 'medium',
    };
    const profiles = {
      load: jest.fn().mockResolvedValue(profile),
      resolveRuntime: jest.fn().mockResolvedValue({ model: 'backend-model', effort: 'medium' }),
    };
    const codex = {
      events: new EventEmitter(),
      startThread: jest.fn().mockResolvedValue({ threadId: 'analysis-thread', sessionId: 'codex-session' }),
      startTurn: jest.fn().mockResolvedValue({ turnId: 'analysis-turn' }),
    };
    const sessionRecords = { forTask: jest.fn().mockResolvedValue([session]) };
    const service = new TaskOrchestratorService(records as any, profiles as any, codex as any, sessionRecords as any);

    const launched = await service.dispatchAnalysis({
      taskId: task.id,
      appId: application.id,
      profile: 'backend-nestjs',
      workingDirectory: 'application',
      focus: 'Inspect the persisted assignment flow',
      skills: ['backend-review-checklist'],
    });

    expect(launched).toMatchObject({
      taskId: task.id,
      sessionId: session.id,
      profile: 'backend-nestjs',
      status: 'running',
    });
    expect(profiles.load).toHaveBeenCalledWith('backend-nestjs');
    expect(session.data).toMatchObject({
      profile: 'backend-nestjs',
      cwd: application.data.path,
      status: 'running',
    });
    expect(codex.startThread).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: application.data.path, mode: 'read-only' }),
    );
    expect(codex.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'analysis-thread', mode: 'read-only' }),
    );
    expect(codex.startThread.mock.calls[0][0].profileInstructions).toContain('Backend profile instructions');
    expect(codex.startThread.mock.calls[0][0].profileInstructions).toContain('Review');
    expect(codex.startThread.mock.calls[0][0].profileInstructions).not.toContain('Tests');
    expect(task.data.sessionIds).toEqual([session.id]);
    const active = await service.getAnalysisResults(task.id);
    expect(sessionRecords.forTask).toHaveBeenCalledWith(task.id, task.projectId, 501, 'analysis');
    expect(active.results).toEqual([
      expect.objectContaining({
        sessionId: session.id,
        profile: 'backend-nestjs',
        status: 'running',
      }),
    ]);
    expect(active.sessionsTruncated).toBe(false);

    await (service as any).handleCodexEvent({
      method: 'turn/completed',
      params: {
        threadId: 'analysis-thread',
        turn: {
          id: 'analysis-turn',
          status: 'completed',
          items: [{ type: 'agentMessage', text: 'Confirmed analysis findings' }],
        },
      },
    });
    expect(session.data).toMatchObject({
      taskId: task.id,
      phase: 'analysis',
      status: 'completed',
      result: 'Confirmed analysis findings',
    });
    const results = await service.getAnalysisResults(task.id);
    expect(results.results).toEqual([
      expect.objectContaining({
        sessionId: session.id,
        profile: 'backend-nestjs',
        status: 'completed',
        result: 'Confirmed analysis findings',
      }),
    ]);
  });

  it('records analysis dispatch errors on the task so the dashboard can show them', async () => {
    const task = {
      id: 'task-analysis-failed',
      kind: 'task',
      projectId: 'project-analysis',
      data: { originalRequest: 'Inspect the backend', status: 'pending_action', sessionIds: [] },
    };
    const app = {
      id: 'app-analysis',
      kind: 'app',
      projectId: task.projectId,
      data: { path: '/repo/apps/manager' },
    };
    const records = {
      get: jest.fn(async (id: string) => (id === task.id ? task : app)),
      updateTask: jest.fn(async (_id: string, patch: any) => {
        task.data = { ...task.data, ...patch };
        return task;
      }),
    };
    const profiles = { load: jest.fn().mockRejectedValue(new Error('Profile file unavailable')) };
    const service = new TaskOrchestratorService(records as any, profiles as any, {} as any, {} as any);

    await expect(
      service.dispatchAnalysis({
        taskId: task.id,
        appId: app.id,
        profile: 'backend-nestjs',
        workingDirectory: 'application',
        focus: 'Inspect the backend',
      }),
    ).rejects.toThrow('Profile file unavailable');

    expect(profiles.load).toHaveBeenCalledWith('backend-nestjs');
    expect(task.data).toMatchObject({
      status: 'pending_action',
      error: 'Profile file unavailable',
      analysisDispatchError: 'Profile file unavailable',
    });
    expect(task.data.sessionIds).toEqual([]);
  });

  it('persists execution-session results for later LLM assessment without setting parent status', async () => {
    const subtask = {
      id: 'subtask-running',
      kind: 'subtask',
      data: { taskId: 'task-running', status: 'running', id: 'step-running' },
    };
    const session = {
      id: 'session-running',
      projectId: 'project-running',
      data: {
        taskId: 'task-running',
        subtaskId: subtask.id,
        threadId: 'execution-thread',
        turnId: 'execution-turn',
        phase: 'execution',
        cwd: '/repo/apps/manager',
        status: 'running',
      },
    };
    const records = {
      findSessionByThreadId: jest.fn().mockResolvedValue(session),
      get: jest.fn().mockResolvedValue(subtask),
      create: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockImplementation(async (id: string, data: any) => {
        if (id === session.id) session.data = data;
        if (id === subtask.id) subtask.data = data;
      }),
      updateTask: jest.fn(),
    };
    const codex = { runCommand: jest.fn().mockResolvedValueOnce(' M file.ts').mockResolvedValueOnce('file.ts | 1 +') };
    const service = new TaskOrchestratorService(records as any, {} as any, codex as any, {} as any);

    await (service as any).handleCodexEvent({
      method: 'turn/completed',
      params: {
        threadId: session.data.threadId,
        turn: {
          id: session.data.turnId,
          status: 'completed',
          items: [{ type: 'agentMessage', text: 'AGENTPIER_RESULT: blocked; environment issue reported' }],
        },
      },
    });

    expect(subtask.data).toMatchObject({
      status: 'awaiting_outcome',
      result: 'AGENTPIER_RESULT: blocked; environment issue reported',
      changes: ' M file.ts',
      diffStat: 'file.ts | 1 +',
    });
    expect(records.updateTask).not.toHaveBeenCalled();
  });

  it('caps analysis session reads and signals when more task sessions exist', async () => {
    const task = { id: 'task-many-sessions', kind: 'task', projectId: 'project-many' };
    const sessions = Array.from({ length: 501 }, (_, index) => ({
      id: `session-${index}`,
      data: { taskId: task.id, phase: 'analysis', status: 'completed', result: `result-${index}` },
    }));
    const records = { get: jest.fn().mockResolvedValue(task) };
    const sessionRecords = { forTask: jest.fn().mockResolvedValue(sessions) };
    const service = new TaskOrchestratorService(records as any, {} as any, {} as any, sessionRecords as any);

    const output = await service.getAnalysisResults(task.id);

    expect(output.sessions).toHaveLength(500);
    expect(output.sessionsTruncated).toBe(true);
    expect(output.results).toHaveLength(500);
    expect(sessionRecords.forTask).toHaveBeenCalledWith(task.id, task.projectId, 501, 'analysis');
  });
});

describe('TaskOrchestratorService branch policy', () => {
  const runStep = async (
    targetBranch: string,
    executionCapabilities: Array<'docker'> = [],
    interruptImmediately = false,
    notifyBeforeStartReturns = true,
    dependencyContext: Record<string, any> = {
      declared: 'contract '.repeat(1000),
      unrelated: 'must-not-leak',
    },
  ) => {
    const task = { id: 'task-12345678', kind: 'task', projectId: 'project-1', data: { originalRequest: 'request' } };
    const subtask = { id: 'subtask-1', data: {} };
    const session = { id: 'session-1', kind: 'session', data: { taskId: task.id, subtaskId: subtask.id } };
    const app = {
      id: 'app-1',
      name: 'Backend',
      kind: 'app',
      projectId: task.projectId,
      data: { name: 'Backend', purpose: 'API', path: '/repo/apps/backend' },
    };
    const repo = {
      id: 'repo-1',
      name: 'PregnantBot',
      kind: 'repository',
      projectId: task.projectId,
      data: { name: 'PregnantBot', path: '/repo' },
    };
    const records = {
      get: jest
        .fn()
        .mockImplementation(async (id: string) =>
          id === app.id
            ? app
            : id === repo.id
              ? repo
              : id === session.id
                ? session
                : id === subtask.id
                  ? subtask
                  : task,
        ),
      update: jest.fn().mockImplementation(async (id: string, data: any) => {
        if (id === session.id) session.data = data;
        if (id === subtask.id) subtask.data = data;
        return id === session.id ? session : subtask;
      }),
      getProjectContext: jest.fn().mockResolvedValue({
        project: { data: {} },
        applications: [],
        repositories: [],
        instructions: [],
        confirmedMemory: [],
      }),
      findSessionByThreadId: jest
        .fn()
        .mockImplementation(async (threadId: string) => (session.data.threadId === threadId ? session : null)),
      create: jest.fn().mockImplementation(async (kind: string, data: any) => {
        if (kind === 'session') {
          session.data = data;
          return session;
        }
        return { id: `${kind}-1`, data };
      }),
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
      startTurn: jest.fn(),
      localDockerSocketPath: jest.fn().mockResolvedValue('/Users/test/.docker/run/docker.sock'),
    };
    const profiles = {
      resolveRuntime: jest.fn().mockResolvedValue({ model: 'backend-model', effort: 'medium' }),
      load: jest.fn().mockResolvedValue({ profile: '', skills: [], version: 'v1', defaultModel: 'backend-model' }),
    };
    const service = new TaskOrchestratorService(records as any, profiles as any, codex as any, {} as any, {} as any);
    codex.startTurn.mockImplementation(async ({ threadId }: { threadId: string }) => {
      const turn = interruptImmediately
        ? {
            id: 'turn-1',
            status: 'interrupted',
            items: [{ type: 'agentMessage', text: 'Partial work before interruption' }],
          }
        : undefined;
      if (turn && notifyBeforeStartReturns)
        await (service as any).handleCodexEvent({ method: 'turn/completed', params: { threadId, turn } });
      return { turnId: 'turn-1', ...(turn ? { status: turn.status, turn } : {}) };
    });
    let execution: any;
    try {
      execution = await (service as any).executeStep(
        task.id,
        task.projectId,
        {
          id: 'step-1',
          title: 'change',
          description: 'change it',
          profile: 'backend-nestjs',
          targetBranch,
          appId: app.id,
          repositoryId: repo.id,
          workingDirectory: 'application',
          dependsOn: ['declared'],
          executionCapabilities,
        },
        subtask,
        app.data.path,
        dependencyContext,
      );
    } catch (error) {
      (error as any).testHarness = { codex, records };
      throw error;
    }
    return { codex, records, execution, session, subtask };
  };

  it('passes the selected assignment context and returns after starting a fresh worker', async () => {
    const { codex, records } = await runStep('feature/work');

    expect(codex.runCommand).toHaveBeenCalledWith('/repo/apps/backend', ['git', 'branch', '--show-current']);
    expect(records.update).toHaveBeenCalledWith('subtask-1', expect.objectContaining({ branch: 'feature/work' }));
    expect(records.update).toHaveBeenCalledWith(
      'subtask-1',
      expect.objectContaining({ status: 'running', sessionId: 'session-1', threadId: 'thread-1' }),
    );
    expect(codex.startThread).toHaveBeenCalledWith(expect.objectContaining({ model: 'backend-model' }));
    expect(codex.startTurn).toHaveBeenCalledWith(expect.objectContaining({ model: 'backend-model', effort: 'medium' }));
    const prompt = codex.startTurn.mock.calls[0][0].prompt;
    expect(prompt).not.toContain('must-not-leak');
    expect(prompt).toContain('Persisted taskId: task-12345678');
    expect(prompt).toContain('Persisted subtaskId: subtask-1');
    expect(prompt).toContain('Selected profile: backend-nestjs');
    expect(prompt).toContain('User-selected target branch: feature/work');
    expect(prompt).toContain('Orchestrator-provided context for declared');
    expect(prompt).not.toContain('Orchestrator-provided context for unrelated');
    const developerInstructions = codex.startThread.mock.calls[0][0].developerInstructions;
    expect(developerInstructions).toContain('Persisted AgentPier task ID: task-12345678');
    expect(developerInstructions).toContain('Persisted subtask ID: subtask-1');
    expect(developerInstructions).toContain('Do not call AgentPier MCP tools such as execute_task or get_task_status');
    expect(developerInstructions).toContain('Application working directory: /repo/apps/backend');
    expect(developerInstructions).toContain('Repository root: /repo');
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

  it('provides a different selected branch to the worker instead of refusing based on branch policy', async () => {
    const { codex } = await runStep('feature/another');
    expect(codex.startThread.mock.calls[0][0].developerInstructions).toContain(
      'User-selected target branch: feature/another',
    );
    expect(codex.startThread.mock.calls[0][0].developerInstructions).toMatch(
      /Do not stop merely because it was not checked out at dispatch/i,
    );
  });

  it('rejects oversized external evidence before reconciling the subtask', async () => {
    const task = {
      id: 'task-1',
      kind: 'task',
      projectId: 'project-1',
      data: { status: 'blocked', approvedPlan: { steps: [{ id: 'step-1' }] } },
    };
    const subtask = {
      id: 'subtask-1',
      kind: 'subtask',
      projectId: 'project-1',
      data: { taskId: task.id, id: 'step-1', status: 'blocked' },
    };
    const records = {
      get: jest.fn(async (id: string) => (id === task.id ? task : subtask)),
      list: jest.fn(),
      update: jest.fn(),
      updateTask: jest.fn(),
    };
    const sessions = { forTask: jest.fn().mockResolvedValue([]) };
    const service = new TaskOrchestratorService(records as any, {} as any, {} as any, {} as any, sessions as any);
    await expect(service.completeFromEvidence(task.id, subtask.id, 'done', ['x'.repeat(2001)], true)).rejects.toThrow(
      /2,000 characters/,
    );
    expect(records.update).not.toHaveBeenCalled();
  });

  it('uses the registered application directory when a step also names its repository', async () => {
    const records = {
      get: jest
        .fn()
        .mockImplementation(async (id: string) =>
          id === 'app-1'
            ? { id, kind: 'app', projectId: 'project-1', data: { path: '/repo/apps/backend' } }
            : { id, kind: 'repository', projectId: 'project-1', data: { path: '/repo' } },
        ),
    };
    const service = new TaskOrchestratorService(records as any, {} as any, {} as any, {} as any, {} as any);
    await expect(
      (service as any).stepRepoPath('project-1', {
        id: 'step-1',
        appId: 'app-1',
        repositoryId: 'repo-1',
        workingDirectory: 'application',
      }),
    ).resolves.toBe('/repo/apps/backend');
    await expect(
      (service as any).stepRepoPath('project-1', {
        id: 'step-2',
        appId: 'app-1',
        repositoryId: 'repo-1',
        workingDirectory: 'repository',
      }),
    ).resolves.toBe('/repo');
  });

  it('rejects a selected app with no absolute registered path before starting a worker', async () => {
    const records = {
      get: jest.fn().mockResolvedValue({
        id: 'app-1',
        kind: 'app',
        projectId: 'project-1',
        data: { name: 'Manager' },
      }),
    };
    const service = new TaskOrchestratorService(records as any, {} as any, {} as any, {} as any, {} as any);

    await expect(
      (service as any).stepRepoPath('project-1', {
        id: 'step-missing-path',
        appId: 'app-1',
        workingDirectory: 'application',
      }),
    ).rejects.toThrow(/valid absolute registered path/);
  });

  it.each([
    [
      { id: 'repo-1', kind: 'app', projectId: 'project-1', data: { path: '/wrong-kind' } },
      'app-1',
      { id: 'app-1', kind: 'app', projectId: 'project-1', data: { path: '/app' } },
      { id: 'step-1', appId: 'app-1', repositoryId: 'repo-1' },
    ],
    [
      { id: 'repo-1', kind: 'repository', projectId: 'other-project', data: { path: '/wrong-project' } },
      'app-1',
      { id: 'app-1', kind: 'app', projectId: 'project-1', data: { path: '/app' } },
      { id: 'step-1', appId: 'app-1', repositoryId: 'repo-1' },
    ],
    [
      { id: 'app-1', kind: 'repository', projectId: 'project-1', data: { path: '/wrong-kind' } },
      'repo-1',
      { id: 'repo-1', kind: 'repository', projectId: 'project-1', data: { path: '/repo' } },
      { id: 'step-1', repositoryId: 'repo-1', appId: 'app-1', workingDirectory: 'repository' },
    ],
    [
      { id: 'app-1', kind: 'app', projectId: 'other-project', data: { path: '/wrong-project' } },
      'repo-1',
      { id: 'repo-1', kind: 'repository', projectId: 'project-1', data: { path: '/repo' } },
      { id: 'step-1', repositoryId: 'repo-1', appId: 'app-1', workingDirectory: 'repository' },
    ],
  ])('rejects invalid supplied records even when unselected', async (invalid, otherId, other, step) => {
    const records = { get: jest.fn(async (id: string) => (id === invalid.id ? invalid : other)) };
    const service = new TaskOrchestratorService(records as any, {} as any, {} as any, {} as any, {} as any);
    await expect((service as any).stepRepoPath('project-1', step)).rejects.toThrow(
      /registered application or repository/,
    );
  });

  it('passes the local Docker socket only for a capability declared in the approved step', async () => {
    const { codex } = await runStep('feature/work', ['docker']);
    expect(codex.localDockerSocketPath).toHaveBeenCalledWith('/repo/apps/backend');
    expect(codex.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ dockerSocketPath: '/Users/test/.docker/run/docker.sock' }),
    );
  });

  it('keeps an immediately interrupted turn terminal and records an incomplete retryable subtask', async () => {
    const { execution, session, subtask } = await runStep('feature/work', [], true);

    expect(session.data).toMatchObject({
      status: 'cancelled',
      turnId: 'turn-1',
      result: 'Partial work before interruption',
      completedAt: expect.any(String),
    });
    expect(subtask.data).toMatchObject({
      status: 'blocked',
      outcomeStatus: 'blocked',
      result: 'Partial work before interruption',
      retryable: true,
      error: 'Codex worker turn was interrupted before completion',
    });
    expect(execution.status).toBe('blocked');
  });

  it('reconciles an interrupted status returned by turn/start even without a notification', async () => {
    const { execution, session, subtask } = await runStep('feature/work', [], true, false);

    expect(session.data).toMatchObject({ status: 'cancelled', result: 'Partial work before interruption' });
    expect(subtask.data).toMatchObject({ status: 'blocked', retryable: true });
    expect(execution.status).toBe('blocked');
  });

  it('preserves blocked and partial dependency outcomes in the worker prompt', async () => {
    const { codex } = await runStep('feature/work', [], false, true, {
      declared: {
        status: 'blocked',
        outcome: 'Partial API contract; verification remains incomplete',
        credentials: { token: 'sensitive-dependency-token' },
      },
    });

    const prompt = codex.startTurn.mock.calls[0][0].prompt;
    expect(prompt).toContain('"status":"blocked"');
    expect(prompt).toContain('Partial API contract; verification remains incomplete');
    expect(prompt).not.toContain('"status":"completed"');
    expect(prompt).not.toContain('sensitive-dependency-token');
  });
});

describe('TaskOrchestratorService project instruction context', () => {
  it('injects confirmed instruction records without legacy project instruction metadata', () => {
    const service = new TaskOrchestratorService({} as any, {} as any, {} as any, {} as any, {} as any);
    const promptContext = (service as any).managedSessions.contextText({
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

describe('TaskOrchestratorService LLM-directed actions', () => {
  it('records the LLM decision to begin without auto-scheduling plan steps', async () => {
    const task = { id: 'task', kind: 'task', data: { approvedPlan: { steps: [{ id: 'selected-by-llm' }] } } };
    const records = { get: jest.fn().mockResolvedValue(task), updateTask: jest.fn().mockResolvedValue(task) };
    const service = new TaskOrchestratorService(records as any, {} as any, {} as any, {} as any, {} as any);
    await expect(service.execute('task', 'Begin backend implementation')).resolves.toBe(task);
    expect(records.get).toHaveBeenCalledWith('task');
    expect(records.updateTask).toHaveBeenCalledWith(
      'task',
      expect.objectContaining({ status: 'executing', executionDecision: 'Begin backend implementation' }),
    );
  });
});

describe('TaskOrchestratorService explicit assignment outcome persistence', () => {
  it('updates only the current approved assignment from blocked to the LLM-selected status', async () => {
    const task = {
      id: 'task-1',
      kind: 'task',
      projectId: 'project-1',
      data: { status: 'blocked', approvedPlan: { steps: [{ id: 'step-1' }] }, subtaskIds: ['subtask-1'] },
    };
    const subtask = {
      id: 'subtask-1',
      kind: 'subtask',
      projectId: 'project-1',
      data: { id: 'step-1', taskId: 'task-1', status: 'blocked' },
    };
    const updated = { ...subtask, data: { ...subtask.data, status: 'completed' } };
    const records = {
      get: jest.fn().mockResolvedValueOnce(task).mockResolvedValueOnce(subtask).mockResolvedValueOnce(updated),
      update: jest.fn().mockResolvedValue(updated),
      updateTask: jest.fn(),
    };
    const service = new TaskOrchestratorService(records as any, {} as any, {} as any, {} as any, {} as any);

    await service.recordAssignmentOutcome('task-1', 'subtask-1', 'completed', 'Worker completed the approved work', [
      'Focused tests passed',
    ]);

    expect(records.update).toHaveBeenCalledWith(
      'subtask-1',
      expect.objectContaining({
        status: 'completed',
        outcomeStatus: 'completed',
        retryable: false,
        orchestratorOutcome: expect.objectContaining({ evidence: ['Focused tests passed'] }),
      }),
    );
    expect(records.updateTask).not.toHaveBeenCalled();
  });
});

describe('TaskOrchestratorService explicit task status', () => {
  it('persists parent status only on an explicit task-status decision', async () => {
    const task = { id: 'task-1', kind: 'task', data: { status: 'blocked' } };
    const records = { get: jest.fn().mockResolvedValue(task), updateTask: jest.fn() };
    const service = new TaskOrchestratorService(records as any, {} as any, {} as any, {} as any, {} as any);
    await service.recordTaskStatus('task-1', 'review_ready', 'Assignments reviewed');
    expect(records.updateTask).toHaveBeenCalledWith('task-1', {
      status: 'review_ready',
      statusDecision: 'Assignments reviewed',
    });
  });
});

describe('TaskOrchestratorService dispatch recovery and assignment scope', () => {
  it('retains earlier dispatch IDs so their outcomes can be recorded after a later dispatch', async () => {
    const firstStep = {
      id: 'step-a',
      profile: 'backend-nestjs',
      appId: 'app-a',
      targetBranch: 'feature/x',
      workingDirectory: 'application',
    };
    const secondStep = {
      id: 'step-b',
      profile: 'backend-nestjs',
      appId: 'app-b',
      targetBranch: 'feature/x',
      workingDirectory: 'application',
    };
    const task = {
      id: 'task-history',
      kind: 'task',
      projectId: 'project-x',
      data: { status: 'review_ready', approvedPlan: { steps: [firstStep, secondStep] }, subtaskIds: [] as string[] },
    };
    const firstAssignment = {
      id: 'assignment-a',
      kind: 'subtask',
      data: { ...firstStep, taskId: task.id, status: 'awaiting_outcome' },
    };
    const secondAssignment = {
      id: 'assignment-b',
      kind: 'subtask',
      data: { ...secondStep, taskId: task.id, status: 'awaiting_outcome' },
    };
    const assignments = [firstAssignment, secondAssignment];
    const records = {
      get: jest.fn(async (id: string) =>
        id === task.id ? task : assignments.find((assignment) => assignment.id === id),
      ),
      create: jest.fn().mockResolvedValueOnce(firstAssignment).mockResolvedValueOnce(secondAssignment),
      list: jest.fn().mockResolvedValue([]),
      updateTask: jest.fn(async (_id: string, patch: Record<string, any>) => {
        task.data = { ...task.data, ...patch };
        return task;
      }),
      update: jest.fn().mockResolvedValue(firstAssignment),
    };
    const profiles = { load: jest.fn().mockResolvedValue({ role: 'backend-nestjs' }) };
    const service = new TaskOrchestratorService(records as any, profiles as any, {} as any, {} as any, {} as any);
    jest.spyOn(service as any, 'stepRepoPath').mockResolvedValue('/repo');
    jest.spyOn(service as any, 'executeStep').mockResolvedValue(undefined);

    await service.dispatchAssignment(task.id, firstStep.id, {});
    await service.dispatchAssignment(task.id, secondStep.id, {});
    await service.recordAssignmentOutcome(task.id, firstAssignment.id, 'completed', 'First step complete', [
      'test passed',
    ]);

    expect(task.data.subtaskIds).toEqual([firstAssignment.id, secondAssignment.id]);
    expect(task.data.status).toBe('review_ready');
    expect(records.updateTask).toHaveBeenCalledTimes(2);
    expect(records.updateTask).toHaveBeenLastCalledWith(task.id, {
      subtaskIds: [firstAssignment.id, secondAssignment.id],
    });
    expect(records.update).toHaveBeenCalledWith(
      firstAssignment.id,
      expect.objectContaining({ status: 'completed', outcomeStatus: 'completed' }),
    );
  });

  it('allows the LLM-selected dispatch even when another session may share the checkout', async () => {
    const step = {
      id: 'step-x',
      profile: 'backend-nestjs',
      appId: 'app-x',
      targetBranch: 'feature/x',
      workingDirectory: 'application',
    };
    const task = { id: 'task-x', kind: 'task', projectId: 'project-x', data: { approvedPlan: { steps: [step] } } };
    const assignment = { id: 'assignment-x', data: { ...step, taskId: task.id, status: 'queued' } };
    const records = {
      get: jest.fn().mockResolvedValue(task),
      list: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(assignment),
      updateTask: jest.fn().mockResolvedValue(task),
    };
    const profiles = { load: jest.fn().mockResolvedValue({ role: 'backend-nestjs' }) };
    const service = new TaskOrchestratorService(records as any, profiles as any, {} as any, {} as any, {} as any);
    jest.spyOn(service as any, 'stepRepoPath').mockResolvedValue('/repo/app-x');
    jest.spyOn(service as any, 'executeStep').mockResolvedValue({ status: 'running' });
    await expect(service.dispatchAssignment(task.id, step.id, {})).resolves.toMatchObject({
      taskId: task.id,
      subtaskId: assignment.id,
      status: 'running',
    });
    expect(records.create).toHaveBeenCalledWith(
      'subtask',
      expect.objectContaining({ id: step.id, taskId: task.id }),
      'project-x',
    );
  });

  it('returns the assignment ID and persists blocked state when a running dispatch fails', async () => {
    const step = {
      id: 'step-x',
      profile: 'backend-nestjs',
      appId: 'app-x',
      targetBranch: 'feature/x',
      workingDirectory: 'application',
    };
    const task = { id: 'task-x', kind: 'task', projectId: 'project-x', data: { approvedPlan: { steps: [step] } } };
    const assignment = { id: 'assignment-x', data: { ...step, taskId: task.id, status: 'queued' } };
    const records = {
      get: jest.fn().mockResolvedValueOnce(task).mockResolvedValueOnce(assignment),
      list: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(assignment),
      update: jest.fn(),
      updateTask: jest.fn(),
    };
    const profiles = { load: jest.fn().mockResolvedValue({ role: 'backend-nestjs' }) };
    const service = new TaskOrchestratorService(records as any, profiles as any, {} as any, {} as any, {} as any);
    jest.spyOn(service as any, 'stepRepoPath').mockResolvedValue('/repo');
    jest.spyOn(service as any, 'executeStep').mockRejectedValue(new Error('app-server disconnected'));

    await expect(service.dispatchAssignment(task.id, step.id, {})).resolves.toMatchObject({
      taskId: task.id,
      subtaskId: assignment.id,
      status: 'blocked',
      error: 'app-server disconnected',
    });
    expect(records.update).toHaveBeenCalledWith(
      assignment.id,
      expect.objectContaining({ status: 'blocked', error: 'app-server disconnected' }),
    );
  });

  it('rejects an outcome for a stale subtask even when it belongs to the same task and approved step', async () => {
    const task = {
      id: 'task-x',
      kind: 'task',
      data: { approvedPlan: { steps: [{ id: 'step-x' }] }, subtaskIds: ['current-assignment'] },
    };
    const stale = {
      id: 'stale-assignment',
      kind: 'subtask',
      data: { id: 'step-x', taskId: task.id, status: 'blocked' },
    };
    const records = { get: jest.fn().mockResolvedValueOnce(task).mockResolvedValueOnce(stale), update: jest.fn() };
    const service = new TaskOrchestratorService(records as any, {} as any, {} as any, {} as any, {} as any);
    await expect(
      service.recordAssignmentOutcome(task.id, stale.id, 'completed', 'Done', ['test passed']),
    ).rejects.toThrow(/dispatched assignment/);
    expect(records.update).not.toHaveBeenCalled();
  });
});
