import { Injectable, Logger } from '@nestjs/common';
import { ManagerService } from '../../manager/services/manager.service';

// Owns Codex turn event normalization, session journaling, and turn waiters.
@Injectable()
export class CodexSessionCoordinatorService {
  private readonly logger = new Logger(CodexSessionCoordinatorService.name);
  private readonly waiters = new Map<string, Array<(event: any) => void>>();
  private readonly terminalTurns = new Map<string, any>();

  constructor(private readonly records: ManagerService) {}

  createSession(data: Record<string, any>, projectId?: string) {
    return this.records.create('session', data, projectId);
  }

  updateSession(id: string, data: Record<string, any>) {
    return this.records.update(id, data);
  }

  createMessage(data: Record<string, any>, projectId?: string) {
    return this.records.create('agent-message', data, projectId);
  }

  async detachActiveSessions() {
    const active = (await this.records.list('session')).filter((row) =>
      ['running', 'waiting_for_user'].includes(row.data.status),
    );
    for (const session of active) await this.records.update(session.id, { ...session.data, attached: false });
  }

  async handleEvent(event: any) {
    const method = event.method;
    const rawParams = event.params || {};
    const params = this.redact(rawParams);
    const sessions = await this.records.list('session');
    const session = sessions.find((row) => row.data.threadId === params.threadId);
    if (!session) return null;
    try {
      await this.records.create(
        'agent-event',
        {
          taskId: session.data.taskId,
          sessionId: session.id,
          threadId: params.threadId,
          method,
          params,
          receivedAt: new Date().toISOString(),
        },
        session.projectId || undefined,
      );
    } catch {
      this.logger.warn('Failed to persist a Codex app-server event');
    }
    if (method === 'item/tool/requestUserInput') {
      await this.records.create(
        'agent-message',
        {
          taskId: session.data.taskId,
          sessionId: session.id,
          threadId: params.threadId,
          serverRequestId: event.id,
          direction: 'agent_to_user',
          kind: 'question',
          questions: this.redact(rawParams.questions),
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
        session.projectId || undefined,
      );
      session.data = { ...session.data, status: 'waiting_for_user' };
      await this.records.update(session.id, session.data);
      return null;
    }
    if (method === 'item/agentMessage/delta') {
      await this.records.create(
        'agent-message',
        {
          taskId: session.data.taskId,
          sessionId: session.id,
          threadId: params.threadId,
          direction: 'agent_to_user',
          kind: 'delta',
          text: this.redact(rawParams.delta),
          status: 'streaming',
          createdAt: new Date().toISOString(),
        },
        session.projectId || undefined,
      );
      return null;
    }
    if (method !== 'turn/completed' && method !== 'turn/error') return null;
    const turn = params.turn || params;
    const turnId = turn?.id || params.turnId || session.data.turnId;
    const status =
      method === 'turn/error'
        ? 'failed'
        : turn?.status === 'completed'
          ? 'completed'
          : turn?.status === 'interrupted'
            ? 'cancelled'
            : 'failed';
    session.data = {
      ...session.data,
      status,
      result: this.extractText(turn),
      completedAt: new Date().toISOString(),
      error: this.redact(turn?.error) || null,
    };
    await this.records.update(session.id, session.data);
    const safeTurn = { ...turn, id: turnId, status, error: this.redact(turn?.error), items: this.redact(turn?.items) };
    if (turnId) {
      const terminal = { turn: safeTurn };
      this.terminalTurns.set(turnId, terminal);
      for (const resolve of this.waiters.get(turnId) || []) resolve(terminal);
      this.waiters.delete(turnId);
    }
    return { session, terminal: { turn: safeTurn } };
  }

  async waitForTurn(_threadId: string, turnId: string, timeoutMs: number) {
    const known = this.terminalTurns.get(turnId);
    if (known) return known;
    return new Promise<any>((resolve, reject) => {
      const complete = (event: any) => {
        clearTimeout(timer);
        resolve(event);
      };
      const list = this.waiters.get(turnId) || [];
      list.push(complete);
      this.waiters.set(turnId, list);
      const timer = setTimeout(() => {
        const remaining = (this.waiters.get(turnId) || []).filter((waiter) => waiter !== complete);
        if (remaining.length) this.waiters.set(turnId, remaining);
        else this.waiters.delete(turnId);
        reject(new Error(`Codex turn timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  private extractText(turn: any): string {
    const results: string[] = [];
    for (const item of turn?.items || []) {
      if (item.type === 'agentMessage' && typeof item.text === 'string') results.push(item.text);
      else if (item.type === 'agentMessage' && Array.isArray(item.content))
        results.push(item.content.map((part: any) => part.text || '').join(''));
    }
    return String(this.redact(results.join('\n\n'))).slice(0, 50000);
  }

  private redact(value: any): any {
    if (Array.isArray(value)) return value.map((child) => this.redact(child));
    if (!value || typeof value !== 'object')
      return typeof value === 'string'
        ? value
            .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/g, '[REDACTED]')
            .replace(/\bsk-[A-Za-z0-9_-]{12,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAKIA[A-Z0-9]{16}\b/g, '[REDACTED]')
            .replace(
              /\b(password|passwd|secret|token|api[_-]?key|authorization|private[_-]?key)\s*[:=]\s*\S+/gi,
              '$1=[REDACTED]',
            )
        : value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) => !/(password|passwd|secret|token|credential|api[_-]?key|private[_-]?key|authorization)/i.test(key),
        )
        .map(([key, child]) => [key, this.redact(child)]),
    );
  }
}
