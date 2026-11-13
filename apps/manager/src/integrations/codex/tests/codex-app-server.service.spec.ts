import { CodexAppServerService } from '../services/codex-app-server.service';

describe('CodexAppServerService model support', () => {
  const createService = () => new CodexAppServerService({} as any, { info: jest.fn(), warn: jest.fn() } as any);

  it('reads and maps paginated model/list data', async () => {
    const service = createService();
    const request = jest
      .spyOn(service, 'request')
      .mockResolvedValueOnce({
        data: [
          {
            model: 'backend-model',
            displayName: 'Backend',
            isDefault: true,
            supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }],
            defaultReasoningEffort: 'medium',
          },
        ],
        nextCursor: 'page-2',
      })
      .mockResolvedValueOnce({
        data: [{ model: 'frontend-model', displayName: 'Frontend', isDefault: false }],
        nextCursor: null,
      });

    await expect(service.listModels()).resolves.toEqual([
      {
        id: 'backend-model',
        displayName: 'Backend',
        isDefault: true,
        supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }],
        defaultReasoningEffort: 'medium',
      },
      {
        id: 'frontend-model',
        displayName: 'Frontend',
        isDefault: false,
        supportedReasoningEfforts: [],
        defaultReasoningEffort: null,
      },
    ]);
    expect(request).toHaveBeenNthCalledWith(1, 'model/list', {});
    expect(request).toHaveBeenNthCalledWith(2, 'model/list', { cursor: 'page-2' });
  });

  it('forwards model and effort only on turns including continued messages', async () => {
    const service = createService();
    const request = jest.spyOn(service, 'request').mockResolvedValue({ turn: { id: 'turn-1' } });
    await service.startTurn({
      threadId: 't',
      cwd: '/repo',
      prompt: 'Analyze',
      mode: 'read-only',
      model: 'm',
      effort: 'medium',
    });
    expect(request).toHaveBeenLastCalledWith('turn/start', expect.objectContaining({ model: 'm', effort: 'medium' }));
    await service.sendMessage('t', 'Continue', { model: 'm', effort: 'high' });
    expect(request).toHaveBeenLastCalledWith('turn/start', expect.objectContaining({ model: 'm', effort: 'high' }));
  });

  it('passes a selected profile model in thread/start', async () => {
    const service = createService();
    const request = jest.spyOn(service, 'request').mockResolvedValue({ thread: { id: 'thread-1' }, cwd: '/repo' });

    await service.startThread({
      cwd: '/repo',
      profileInstructions: 'Profile',
      developerInstructions: 'Contract',
      mode: 'workspace-write',
      model: 'frontend-model',
    });

    expect(request.mock.calls[0][1]).not.toHaveProperty('effort');
    expect(request.mock.calls[0][1]).not.toHaveProperty('reasoningEffort');
    expect(request).toHaveBeenCalledWith(
      'thread/start',
      expect.objectContaining({ model: 'frontend-model', sandbox: 'workspace-write' }),
    );
  });
});

describe('CodexAppServerService managed sandbox policies', () => {
  const createService = () => new CodexAppServerService({} as any, { info: jest.fn(), warn: jest.fn() } as any);

  it.each(['read-only', 'workspace-write'] as const)(
    'keeps ordinary %s turns network-disabled without broadening filesystem access or approvals',
    async (mode) => {
      const service = createService();
      const request = jest.spyOn(service, 'request').mockResolvedValue({ turn: { id: 'turn-1' } });

      await expect(service.startTurn({ threadId: 'thread-1', cwd: '/repo', prompt: 'Work', mode })).resolves.toEqual({
        turnId: 'turn-1',
      });

      expect(request).toHaveBeenCalledWith('turn/start', {
        threadId: 'thread-1',
        cwd: '/repo',
        input: [{ type: 'text', text: 'Work', text_elements: [] }],
        approvalPolicy: 'never',
        sandboxPolicy:
          mode === 'read-only'
            ? { type: 'readOnly', networkAccess: false }
            : { type: 'workspaceWrite', writableRoots: ['/repo'], networkAccess: false },
      });

      // Continued turns inherit the accepted thread policy; do not reset it.
      await service.sendMessage('thread-1', 'Continue');
      expect(request).toHaveBeenLastCalledWith('turn/start', {
        threadId: 'thread-1',
        input: [{ type: 'text', text: 'Continue', text_elements: [] }],
      });
    },
  );

  it.each([false, true])('keeps host command network disabled (write=%s)', async (write) => {
    const service = createService();
    const request = jest.spyOn(service, 'request').mockResolvedValue({ exitCode: 0, stdout: 'ok' });

    await expect(service.runCommand('/repo', ['git', 'status'], 20000, write)).resolves.toBe('ok');
    expect(request).toHaveBeenCalledWith(
      'command/exec',
      {
        cwd: '/repo',
        command: ['git', 'status'],
        timeoutMs: 20000,
        sandboxPolicy: write
          ? { type: 'workspaceWrite', writableRoots: ['/repo'], networkAccess: false }
          : { type: 'readOnly', networkAccess: false },
      },
      25000,
    );
  });
});

describe('scoped release policy', () => {
  const operations = [{ type: 'push' as const, remote: 'origin', ref: 'feature/work' }];
  const harness = (gitDir = '/repo/.git') => {
    const service = new CodexAppServerService({} as any, {} as any);
    const request = jest.spyOn(service, 'request').mockImplementation(async (method, params) => {
      if (method === 'turn/start') return { turn: { id: 'turn' } };
      const cmd = params.command;
      const stdout =
        cmd[0] === 'pwd'
          ? params.cwd
          : cmd.includes('--show-toplevel')
            ? '/repo'
            : cmd.includes('--absolute-git-dir') || cmd.includes('--git-common-dir')
              ? gitDir
              : 'ok';
      return { exitCode: 0, stdout };
    });
    return { service, request };
  };
  it('grants release turns and host exec network plus only the resolved Git directory', async () => {
    const { service, request } = harness();
    await service.startTurn({
      threadId: 't',
      cwd: '/repo',
      prompt: 'Release',
      mode: 'workspace-write',
      releaseOperations: operations,
    });
    const sandboxPolicy = { type: 'workspaceWrite', writableRoots: ['/repo', '/repo/.git'], networkAccess: true };
    expect(request).toHaveBeenLastCalledWith(
      'turn/start',
      expect.objectContaining({ approvalPolicy: 'never', sandboxPolicy }),
    );
    await service.runCommand('/repo', ['git', 'push', 'origin', 'feature/work'], 20000, true, operations);
    expect(request).toHaveBeenLastCalledWith('command/exec', expect.objectContaining({ sandboxPolicy }), 25000);
  });
  it('fails closed for malformed scopes, read-only release turns and external Git directories', async () => {
    const { service, request } = harness('/elsewhere/.git');
    await expect(
      service.startTurn({
        threadId: 't',
        cwd: '/repo',
        prompt: '',
        mode: 'workspace-write',
        releaseOperations: operations,
      }),
    ).rejects.toThrow(/stay under/);
    await expect(service.runCommand('/repo', ['git', 'push'], 20000, true, [])).rejects.toThrow(/Invalid release/);
    await expect(
      service.startTurn({ threadId: 't', cwd: '/repo', prompt: '', mode: 'read-only', releaseOperations: operations }),
    ).rejects.toThrow(/workspace-write/);
    expect(request.mock.calls.every(([method]) => method !== 'turn/start')).toBe(true);
  });
});
