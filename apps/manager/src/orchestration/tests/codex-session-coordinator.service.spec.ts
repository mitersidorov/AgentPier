import { CodexSessionCoordinatorService } from '../services/codex-session-coordinator.service';

describe('CodexSessionCoordinatorService', () => {
  const setup = () => {
    const session = {
      id: 'session-1',
      kind: 'session',
      projectId: 'project-1',
      data: { threadId: 'thread-1', turnId: 'turn-1', taskId: 'task-1', status: 'running', phase: 'execution' },
    };
    const records = {
      findSessionByThreadId: jest.fn().mockResolvedValue(session),
      get: jest.fn().mockResolvedValue(session),
      update: jest.fn().mockImplementation(async (_id: string, data: any) => {
        session.data = data;
        return session;
      }),
      create: jest.fn().mockResolvedValue({ id: 'record-1' }),
      listActiveSessions: jest.fn().mockResolvedValue([]),
    };
    return { session, records, coordinator: new CodexSessionCoordinatorService(records as any) };
  };

  it('resolves a waiter when the terminal event arrives during registration', async () => {
    const { coordinator } = setup();
    const waiting = coordinator.waitForTurn('thread-1', 'turn-1', 500);
    await coordinator.handleEvent({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', items: [] } },
    });
    await expect(waiting).resolves.toMatchObject({ turn: { id: 'turn-1', status: 'completed' } });
    await expect(coordinator.waitForTurn('thread-1', 'turn-1', 500)).resolves.toMatchObject({
      turn: { status: 'completed' },
    });
  });

  it('removes timed-out waiters so later terminal events do not retain them', async () => {
    const { coordinator } = setup();
    await expect(coordinator.waitForTurn('thread-1', 'turn-1', 1)).rejects.toThrow('Codex turn timed out after 1ms');
    expect((coordinator as any).waiters.has('turn-1')).toBe(false);
    await coordinator.handleEvent({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', items: [] } },
    });
    expect((coordinator as any).waiters.has('turn-1')).toBe(false);
  });

  it('persists an interrupted turn as terminal and resolves it as an incomplete outcome', async () => {
    const { session, coordinator } = setup();

    const handled = await coordinator.handleEvent({
      method: 'turn/completed',
      params: {
        threadId: 'thread-1',
        turn: { id: 'turn-1', status: 'interrupted', items: [{ type: 'agentMessage', text: 'Partial findings' }] },
      },
    });

    expect(session.data).toMatchObject({
      status: 'cancelled',
      result: 'Partial findings',
      completedAt: expect.any(String),
    });
    expect(handled?.terminal.turn.status).toBe('cancelled');
  });

  it('attaches a late turn id without reviving a session already marked terminal', async () => {
    const { session, coordinator } = setup();
    session.data.status = 'cancelled';

    const attached = await coordinator.attachTurn(session.id, 'turn-1');

    expect(attached.data).toMatchObject({ status: 'cancelled', turnId: 'turn-1' });
  });

  it('redacts PEM private-key blocks embedded in ordinary text', async () => {
    const { coordinator } = setup();
    const value = 'before -----BEGIN RSA PRIVATE KEY-----\\nprivate material\\n-----END RSA PRIVATE KEY----- after';
    expect((coordinator as any).redact(value)).toBe('before [REDACTED] after');
  });
});
