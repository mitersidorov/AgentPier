import { Injectable } from '@nestjs/common';

@Injectable()
export class AppServerService {
  private readonly base = process.env.CODEX_APP_SERVER_URL || 'ws://host.docker.internal:4500';

  async status() {
    const readyUrl = this.base.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:').replace(/\/$/, '') + '/readyz';
    const healthUrl = readyUrl.replace(/\/readyz$/, '/healthz');
    const [ready, health] = await Promise.all([this.get(readyUrl), this.get(healthUrl)]);
    return {
      url: this.base,
      ready: ready.ok,
      health: health.ok,
      readyStatus: ready.status,
      healthStatus: health.status,
      reason: ready.ok
        ? undefined
        : `Codex app-server is not ready at ${readyUrl} (HTTP ${ready.status ?? 'unreachable'}). Start it on the Mac and expose port 4500 to Docker.`,
    };
  }

  async websocketCheck() {
    const status = await this.status();
    try {
      const socket = new WebSocket(this.base);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('WebSocket handshake timed out')), 2500);
        socket.addEventListener(
          'open',
          () => {
            clearTimeout(timeout);
            socket.close();
            resolve();
          },
          { once: true },
        );
        socket.addEventListener(
          'error',
          () => {
            clearTimeout(timeout);
            reject(new Error('WebSocket handshake failed'));
          },
          { once: true },
        );
      });
      return { connected: true, ready: status.ready, health: status.health };
    } catch (error) {
      return {
        connected: false,
        ready: status.ready,
        health: status.health,
        reason: `WebSocket connection failed: ${error instanceof Error ? error.message : 'unknown error'}. ${status.reason || ''}`,
      };
    }
  }

  private async get(url: string) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
      return { ok: response.ok, status: response.status };
    } catch {
      return { ok: false, status: undefined };
    }
  }
}
