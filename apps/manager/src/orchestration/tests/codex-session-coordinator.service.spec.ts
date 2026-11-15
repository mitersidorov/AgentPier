import { CodexSessionCoordinatorService } from '../services/codex-session-coordinator.service';

describe('CodexSessionCoordinatorService', () => {
  const setup = () => {
    const session = {
      id: 'session-1',
      projectId: 'project-1',
      data: { threadId: 'thread-1', turnId: 'turn-1', taskId: 'task-1', status: 'running', phase: 'execution' },
    };
    const records = {
      list: jest.fn().mockResolvedValue([session]),
      update: jest.fn().mockResolvedValue(session),
      create: jest.fn().mockResolvedValue({ id: 'record-1' }),
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

  it('redacts PEM private-key blocks embedded in ordinary text', async () => {
    const { coordinator } = setup();
    const value = 'before -----BEGIN RSA PRIVATE KEY-----\\nprivate material\\n-----END RSA PRIVATE KEY----- after';
    expect((coordinator as any).redact(value)).toBe('before [REDACTED] after');
  });
});
