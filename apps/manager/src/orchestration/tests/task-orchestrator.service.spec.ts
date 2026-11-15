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

describe('TaskOrchestratorService branch policy', () => {
  const runStep = async (
    targetBranch: string,
    result = 'AGENTPIER_RESULT: completed',
    executionCapabilities: Array<'docker'> = [],
  ) => {
    const task = { id: 'task-12345678', kind: 'task', projectId: 'project-1', data: { originalRequest: 'request' } };
    const subtask = { id: 'subtask-1', data: {} };
    const session = { id: 'session-1', data: { taskId: task.id, subtaskId: subtask.id } };
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
      update: jest.fn().mockResolvedValue(subtask),
      getProjectContext: jest.fn().mockResolvedValue({
        project: { data: {} },
        applications: [],
        repositories: [],
        instructions: [],
        confirmedMemory: [],
      }),
      create: jest.fn().mockResolvedValue(session),
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
      localDockerSocketPath: jest.fn().mockResolvedValue('/Users/test/.docker/run/docker.sock'),
    };
    const profiles = {
      resolveRuntime: jest.fn().mockResolvedValue({ model: 'backend-model', effort: 'medium' }),
      load: jest.fn().mockResolvedValue({ profile: '', skills: [], version: 'v1', defaultModel: 'backend-model' }),
    };
    const service = new TaskOrchestratorService(records as any, profiles as any, codex as any, {} as any, {} as any);
    (service as any).sessionCoordinator.terminalTurns.set('turn-1', {
      turn: { status: 'completed', items: [{ type: 'agentMessage', text: result }] },
    });
    try {
      await (service as any).executeStep(
        task.id,
        task.projectId,
        {
          id: 'step-1',
          title: 'change',
          description: 'change it',
          targetBranch,
          appId: app.id,
          repositoryId: repo.id,
          dependsOn: ['declared'],
          executionCapabilities,
        },
        subtask,
        app.data.path,
        { declared: 'contract '.repeat(1000), unrelated: 'must-not-leak' },
      );
    } catch (error) {
      (error as any).testHarness = { codex, records };
      throw error;
    }
    return { codex, records };
  };

  it('uses the explicitly selected active branch without switching or creating a branch', async () => {
    const { codex, records } = await runStep('feature/work');

    expect(codex.runCommand).toHaveBeenCalledWith('/repo/apps/backend', ['git', 'branch', '--show-current']);
    expect(records.update).toHaveBeenCalledWith('subtask-1', expect.objectContaining({ branch: 'feature/work' }));
    expect(codex.startThread).toHaveBeenCalledWith(expect.objectContaining({ model: 'backend-model' }));
    expect(codex.startTurn).toHaveBeenCalledWith(expect.objectContaining({ model: 'backend-model', effort: 'medium' }));
    const prompt = codex.startTurn.mock.calls[0][0].prompt;
    expect(prompt).not.toContain('must-not-leak');
    expect(prompt).toContain('"stepId":"declared"');
    expect(prompt).toContain('"truncated":true');
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

  it('refuses to execute when the explicitly requested branch is not already checked out', async () => {
    await expect(runStep('feature/another')).rejects.toThrow(/AgentPier will not switch branches/);
  });

  it.each(['AGENTPIER_RESULT: blocked', 'AGENTPIER_RESULT: partial', 'No completion marker; I cannot proceed'])(
    'keeps a refused or incomplete turn retryable instead of marking its subtask complete: %s',
    async (result) => {
      let failure: any;
      try {
        await runStep('feature/work', result);
      } catch (error) {
        failure = error;
      }
      expect(failure?.message).toMatch(/Agent reported|did not provide/);
      const { records } = failure.testHarness;
      expect(records.update).toHaveBeenCalledWith(
        'subtask-1',
        expect.objectContaining({ status: 'blocked', retryable: true }),
      );
    },
  );

  it('continues a completed blocked turn in read-only mode to collect its missing final marker', async () => {
    const task = { id: 'task-1', kind: 'task', projectId: 'project-1', data: { error: 'missing completion marker' } };
    const subtask = {
      id: 'subtask-1',
      kind: 'subtask',
      data: {
        id: 'frontend-russian-localization',
        taskId: task.id,
        status: 'blocked',
        error: 'Agent did not provide the required AGENTPIER_RESULT completion status',
        sessionId: 'session-1',
        path: '/repo/apps/webapp',
        branch: 'dev/pregnantbot-implementation',
        result:
          'Implemented localization. See reports/frontend-russian-localization.md; typecheck, Docker build, and 8 E2E tests passed.',
      },
    };
    const session = {
      id: 'session-1',
      kind: 'session',
      data: {
        taskId: task.id,
        status: 'blocked',
        turnStatus: 'completed',
        threadId: 'thread-1',
        subtaskId: subtask.id,
        cwd: subtask.data.path,
        effectiveModel: 'frontend-model',
        effectiveReasoningEffort: 'medium',
      },
    };
    const records = {
      get: jest.fn(async (id: string) => (id === task.id ? task : session)),
      create: jest.fn().mockResolvedValue({ id: 'final-session', data: {} }),
      update: jest.fn(async (id: string, data: any) => ({ id, kind: 'session', data })),
    };
    const codex = {
      startThread: jest.fn().mockResolvedValue({ threadId: 'final-thread', sessionId: 'codex-final-session' }),
      startTurn: jest.fn().mockResolvedValue({ turnId: 'final-turn' }),
    };
    const profiles = {
      resolveRuntime: jest.fn().mockResolvedValue({ model: 'frontend-model', effort: 'medium' }),
      load: jest.fn().mockResolvedValue({ profile: 'Frontend profile', skills: [] }),
    };
    const service = new TaskOrchestratorService(records as any, profiles as any, codex as any, {} as any, {} as any);
    (service as any).sessionCoordinator.terminalTurns.set('final-turn', {
      turn: {
        status: 'completed',
        items: [
          {
            type: 'agentMessage',
            text: 'Verified existing report: typecheck and production build passed; Playwright E2E: 8 passed. Browser SIGTRAP was isolated to the agent session.\nAGENTPIER_RESULT: completed',
          },
        ],
      },
    });
    const latest = new Map([[subtask.data.id, subtask]]);

    await (service as any).finalizeMissingMarker(
      task.id,
      [
        {
          id: subtask.data.id,
          title: 'Localize frontend',
          description: 'Preserve current changes and verify the report',
          profile: 'frontend-angular',
          targetBranch: subtask.data.branch,
          appId: 'app-1',
        },
      ],
      latest,
    );

    expect(codex.startThread).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'read-only', cwd: subtask.data.path }),
    );
    expect(codex.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'final-thread', cwd: subtask.data.path, mode: 'read-only' }),
    );
    const prompt = codex.startTurn.mock.calls[0][0].prompt;
    expect(prompt).toContain('Do not repeat implementation');
    expect(prompt).toContain('do not repeat them');
    expect(prompt).toContain('Do not commit, push');
    expect(latest.get(subtask.data.id).data).toMatchObject({
      status: 'completed',
      outcomeStatus: 'completed',
      retryable: false,
      completionEvidence: 'agent-finalization-report',
    });
  });

  it.each([
    ['wrong task', { taskId: 'other-task' }],
    ['wrong subtask', { subtaskId: 'other-subtask' }],
    ['active turn', { status: 'running', turnStatus: 'inProgress' }],
  ])('does not finalize a mismatched or active session (%s)', async (_label, override) => {
    const task = { id: 'task-1', kind: 'task', projectId: 'project-1', data: { error: 'completion marker missing' } };
    const subtask = {
      id: 'subtask-1',
      kind: 'subtask',
      data: {
        id: 'step-1',
        taskId: task.id,
        status: 'blocked',
        error: 'Agent did not provide the required AGENTPIER_RESULT completion status',
        sessionId: 'session-1',
        path: '/repo',
      },
    };
    const session = {
      id: 'session-1',
      kind: 'session',
      data: {
        taskId: task.id,
        subtaskId: subtask.id,
        status: 'blocked',
        turnStatus: 'completed',
        threadId: 'thread-1',
        cwd: '/repo',
        ...override,
      },
    };
    const records = {
      get: jest.fn(async (id: string) => (id === task.id ? task : session)),
      create: jest.fn(),
      update: jest.fn(),
    };
    const service = new TaskOrchestratorService(
      records as any,
      {} as any,
      { startThread: jest.fn() } as any,
      {} as any,
      {} as any,
    );
    await (service as any).finalizeMissingMarker(task.id, [{ id: 'step-1' }], new Map([['step-1', subtask]]));
    expect(records.create).not.toHaveBeenCalled();
  });

  it('reconciles user-confirmed external checks without pretending the cancelled agent session completed', async () => {
    const task = {
      id: 'task-1',
      kind: 'task',
      projectId: 'project-1',
      data: {
        status: 'cancelled',
        approvedPlan: { steps: [{ id: 'frontend-step' }] },
        subtaskIds: ['subtask-1'],
      },
    };
    const subtask = {
      id: 'subtask-1',
      kind: 'subtask',
      projectId: 'project-1',
      data: { taskId: task.id, id: 'frontend-step', status: 'cancelled', attempt: 1 },
    };
    const records = {
      get: jest.fn(async (id: string) => (id === task.id ? task : subtask)),
      list: jest.fn().mockResolvedValue([subtask]),
      update: jest.fn(async (_id: string, data: any) => ({ ...subtask, data })),
      updateTask: jest.fn(async (_id: string, data: any) => ({ ...task, data: { ...task.data, ...data } })),
    };
    const sessions = { forTask: jest.fn().mockResolvedValue([{ data: { status: 'cancelled' } }]) };
    const service = new TaskOrchestratorService(records as any, {} as any, {} as any, {} as any, sessions as any);

    const result = await service.completeFromEvidence(
      task.id,
      subtask.id,
      'Russian localization is already present in the existing working tree.',
      ['npm run typecheck passed', 'Production Docker build passed', 'Full Playwright E2E passed: 8 tests'],
      true,
    );

    expect(records.update).toHaveBeenCalledWith(
      subtask.id,
      expect.objectContaining({
        status: 'completed',
        outcomeStatus: 'completed',
        completionEvidence: expect.objectContaining({ source: 'user-confirmed-external-verification' }),
        result: expect.not.stringContaining('AGENTPIER_RESULT: completed'),
      }),
    );
    expect(records.updateTask).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ status: 'review_ready', subtaskIds: [subtask.id] }),
    );
    expect(result.data.status).toBe('review_ready');
    expect(records.update.mock.calls[0][1].completionEvidence).toEqual({
      source: 'user-confirmed-external-verification',
      evidence: ['npm run typecheck passed', 'Production Docker build passed', 'Full Playwright E2E passed: 8 tests'],
    });
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
      (service as any).stepRepoPath('project-1', { id: 'step-1', appId: 'app-1', repositoryId: 'repo-1' }),
    ).resolves.toBe('/repo/apps/backend');
    await expect(
      (service as any).stepRepoPath('project-1', {
        id: 'step-2',
        appId: 'app-1',
        repositoryId: 'repo-1',
        checks: ['docker compose config'],
      }),
    ).resolves.toBe('/repo');
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

  it('allows sibling application directories to run in parallel but locks repository-root overlaps', () => {
    const service = new TaskOrchestratorService({} as any, {} as any, {} as any, {} as any, {} as any);
    expect((service as any).pathsOverlap('/repo/apps/backend', '/repo/apps/webapp')).toBe(false);
    expect((service as any).pathsOverlap('/repo', '/repo/apps/backend')).toBe(true);
  });

  it('blocks repository-root work while an application session is active but permits sibling applications', async () => {
    const records = {
      list: jest.fn(async (kind: string) =>
        kind === 'session' ? [{ data: { status: 'running', cwd: '/repo/apps/backend' } }] : [],
      ),
    };
    const service = new TaskOrchestratorService(records as any, {} as any, {} as any, {} as any, {} as any);
    await expect(
      (service as any).assertNoActivePathSessions('project-1', '/repo/apps/webapp', 'other-task'),
    ).resolves.toBeUndefined();
    await expect((service as any).assertNoActivePathSessions('project-1', '/repo', 'other-task')).rejects.toThrow(
      /overlapping managed session is already running/,
    );
  });

  it('requires an explicit target branch instead of inferring or creating one', () => {
    const service = new TaskOrchestratorService({} as any, {} as any, {} as any, {} as any, {} as any);
    expect(() =>
      (service as any).approvedPlanExecution.normalizeSteps(
        [{ title: 'change', description: 'change it' }],
        new Set(['backend-nestjs']),
      ),
    ).toThrow(/Ask the user which branch to use and wait/);
  });

  it('derives scoped Docker access and repository working directory from an approved Compose check', () => {
    const service = new TaskOrchestratorService({} as any, {} as any, {} as any, {} as any, {} as any);
    const [step] = (service as any).approvedPlanExecution.normalizeSteps(
      [
        {
          id: 'runtime',
          title: 'Run local integration',
          description: 'Run approved Compose checks',
          targetBranch: 'fix/task',
          profile: 'backend-nestjs',
          appId: 'app-id',
          repositoryId: 'repo-id',
          checks: ['docker compose config', 'Full local E2E'],
        },
      ],
      new Set(['backend-nestjs']),
    );
    expect(step.executionCapabilities).toEqual(['docker']);
    expect(step.workingDirectory).toBe('repository');
  });

  it('passes the local Docker socket only for a capability declared in the approved step', async () => {
    const { codex } = await runStep('feature/work', 'AGENTPIER_RESULT: completed', ['docker']);
    expect(codex.localDockerSocketPath).toHaveBeenCalledWith('/repo/apps/backend');
    expect(codex.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ dockerSocketPath: '/Users/test/.docker/run/docker.sock' }),
    );
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

describe('TaskOrchestratorService retry behavior', () => {
  const steps = [
    {
      id: 'frontend',
      title: 'Frontend',
      description: 'Update UI',
      profile: 'frontend-angular',
      targetBranch: 'fix/task',
    },
    { id: 'backend', title: 'Backend', description: 'Update API', profile: 'backend-nestjs', targetBranch: 'fix/task' },
  ];

  const retryHarness = (status: string, backendStatus: string, backendResult: string) => {
    const task = {
      id: 'task-1',
      kind: 'task',
      projectId: 'project-1',
      data: { status, approvedPlan: { steps }, attempt: 1 },
    };
    const previous = [
      {
        id: 'frontend-old',
        data: {
          id: 'frontend',
          taskId: task.id,
          title: 'Frontend',
          attempt: 1,
          status: 'completed',
          outcomeStatus: 'completed',
          result: 'Frontend work completed. AGENTPIER_RESULT: completed',
        },
      },
      {
        id: 'backend-old',
        data: {
          id: 'backend',
          taskId: task.id,
          title: 'Backend',
          attempt: 1,
          status: backendStatus,
          result: backendResult,
        },
      },
    ];
    const records = {
      get: jest.fn().mockResolvedValue(task),
      list: jest.fn(async (kind: string) => (kind === 'subtask' ? previous : [])),
      create: jest
        .fn()
        .mockResolvedValue({ id: 'backend-retry', data: { id: 'backend', taskId: task.id, status: 'queued' } }),
      update: jest.fn().mockResolvedValue(undefined),
      updateTask: jest.fn(async (_id: string, patch: any) => ({ ...task, data: { ...task.data, ...patch } })),
    };
    const service = new TaskOrchestratorService(
      records as any,
      { list: jest.fn().mockResolvedValue([{ role: 'backend-nestjs' }, { role: 'frontend-angular' }]) } as any,
      {} as any,
      {} as any,
      { forTask: jest.fn().mockResolvedValue([]) } as any,
    );
    (service as any).executeGraph = jest.fn().mockResolvedValue(undefined);
    return { task, previous, records, service };
  };

  it('retries only blocked steps with a new subtask and reuses successful dependencies', async () => {
    const { records, service } = retryHarness('blocked', 'blocked', 'Agent cannot access approval-required tools.');
    await service.execute('task-1');
    expect(records.create).toHaveBeenCalledTimes(1);
    expect(records.create).toHaveBeenCalledWith(
      'subtask',
      expect.objectContaining({ id: 'backend', attempt: 2, status: 'queued' }),
      'project-1',
    );
    expect((service as any).executeGraph).toHaveBeenCalledWith(
      'task-1',
      steps.map((step) => ({ ...step, dependsOn: [], executionCapabilities: [], workingDirectory: undefined })),
      [expect.objectContaining({ id: 'frontend-old' }), expect.objectContaining({ id: 'backend-retry' })],
    );
  });

  it('reclassifies a legacy completed refusal as blocked and makes it retryable', async () => {
    const { records, service } = retryHarness(
      'review_ready',
      'completed',
      'I can’t begin because AgentPier MCP requires approval and policy is never. No files changed.',
    );
    await service.execute('task-1');
    expect(records.update).toHaveBeenCalledWith(
      'backend-old',
      expect.objectContaining({ status: 'blocked', outcomeStatus: 'blocked', retryable: true }),
    );
    expect(records.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ status: 'blocked' }));
    expect(records.create).toHaveBeenCalledTimes(1);
  });

  it('does not start a retry while a previous task session is active', async () => {
    const task = {
      id: 'task-1',
      kind: 'task',
      projectId: 'project-1',
      data: { status: 'blocked', approvedPlan: { steps }, attempt: 1 },
    };
    const records = {
      get: jest.fn().mockResolvedValue(task),
      list: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    };
    const service = new TaskOrchestratorService(
      records as any,
      { list: jest.fn().mockResolvedValue([{ role: 'backend-nestjs' }, { role: 'frontend-angular' }]) } as any,
      {} as any,
      {} as any,
      { forTask: jest.fn().mockResolvedValue([{ data: { status: 'running' } }]) } as any,
    );
    await expect(service.execute('task-1')).rejects.toThrow(/prior task sessions are still active/);
    expect(records.create).not.toHaveBeenCalled();
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
