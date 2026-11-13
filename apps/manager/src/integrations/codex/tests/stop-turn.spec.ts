import { CodexAppServerService } from '../services/codex-app-server.service';

describe('CodexAppServerService.stopTurnAndWait', () => {
  const service = new CodexAppServerService({} as any, {} as any);
  const snapshot = (status: string) => ({ thread: { turns: [{ id: 'turn', status }] } });
  let request: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    request = jest.spyOn(service, 'request');
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('waits after interrupt acknowledgement until a detached turn is confirmed interrupted', async () => {
    request
      .mockResolvedValueOnce(snapshot('inProgress'))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(snapshot('inProgress'))
      .mockResolvedValueOnce(snapshot('interrupted'));
    let finished = false;
    const stopped = service.stopTurnAndWait('thread', 'turn').then(() => {
      finished = true;
    });
    await jest.advanceTimersByTimeAsync(250);
    expect(finished).toBe(false);
    await jest.advanceTimersByTimeAsync(250);
    await stopped;
    expect(request).toHaveBeenNthCalledWith(1, 'thread/read', { threadId: 'thread', includeTurns: true }, 60000);
    expect(request).toHaveBeenNthCalledWith(2, 'turn/interrupt', { threadId: 'thread', turnId: 'turn' }, 60000);
  });

  it.each(['completed', 'interrupted'])('accepts confirmed %s without interruption', async (status) => {
    request.mockResolvedValue(snapshot(status));
    await service.stopTurnAndWait('thread', 'turn');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([snapshot('failed'), snapshot('unknown'), { thread: { turns: [] } }, {}])(
    'rejects failed, missing or unknown state: %j',
    async (response) => {
      request.mockResolvedValue(response);
      await expect(service.stopTurnAndWait('thread', 'turn')).rejects.toThrow('unknown turn state');
    },
  );

  it('propagates an interruption error', async () => {
    request.mockResolvedValueOnce(snapshot('inProgress')).mockRejectedValueOnce(new Error('interrupt failed'));
    await expect(service.stopTurnAndWait('thread', 'turn')).rejects.toThrow('interrupt failed');
  });

  it('propagates a disconnected read', async () => {
    request.mockRejectedValue(new Error('disconnected'));
    await expect(service.stopTurnAndWait('thread', 'turn')).rejects.toThrow('disconnected');
  });

  it('times out even when interruption was acknowledged', async () => {
    request.mockResolvedValue(snapshot('inProgress'));
    const stopped = expect(service.stopTurnAndWait('thread', 'turn', 500)).rejects.toThrow('Timed out');
    await jest.advanceTimersByTimeAsync(500);
    await stopped;
  });
  it('bounds a stalled request including connection establishment', async () => {
    request.mockImplementation(() => new Promise(() => {}));
    const stopped = expect(service.stopTurnAndWait('thread', 'turn', 500)).rejects.toThrow('Timed out');
    await jest.advanceTimersByTimeAsync(500);
    await stopped;
  });
});
