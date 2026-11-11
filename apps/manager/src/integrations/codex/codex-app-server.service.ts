import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { relative, resolve } from 'node:path';

type RpcMessage = { id?: string | number; method?: string; params?: any; result?: any; error?: any };

@Injectable()
export class CodexAppServerService implements OnModuleDestroy {
  private readonly url = process.env.CODEX_APP_SERVER_URL || 'ws://host.docker.internal:4500';
  private socket?: WebSocket;
  private connecting?: Promise<void>;
  private id = 0;
  private pending = new Map<
    string,
    { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  readonly events = new EventEmitter();

  async status() {
    const root = this.url.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:').replace(/\/$/, '');
    const [readyz, healthz] = await Promise.all([this.get(`${root}/readyz`), this.get(`${root}/healthz`)]);
    try {
      const initialized = await this.connect();
      return { connected: true, ready: readyz.ok, health: healthz.ok, url: this.url, appServer: initialized };
    } catch (error) {
      return {
        connected: false,
        ready: readyz.ok,
        health: healthz.ok,
        url: this.url,
        reason: `Codex app-server WebSocket unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
      };
    }
  }

  async connect(): Promise<any> {
    if (this.socket?.readyState === WebSocket.OPEN && this.initialized) return this.initialized;
    if (this.connecting) return this.connecting.then(() => this.initialized);
    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error('WebSocket handshake timed out'));
      }, 8000);
      socket.addEventListener(
        'open',
        async () => {
          clearTimeout(timeout);
          this.socket = socket;
          socket.addEventListener('message', (event) => this.onMessage(String(event.data)));
          socket.addEventListener('close', () => this.onClose());
          socket.addEventListener('error', () => this.onClose());
          try {
            this.initialized = await this.rawRequest('initialize', {
              clientInfo: { name: 'agentpier-manager', title: 'AgentPier Manager', version: '0.1.0' },
              capabilities: { experimentalApi: true },
            });
            socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }));
            resolve();
          } catch (error) {
            socket.close();
            reject(error);
          }
        },
        { once: true },
      );
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timeout);
          reject(
            new Error(
              'WebSocket connection failed; check that app-server is listening on port 4500 and Docker can reach the Mac host',
            ),
          );
        },
        { once: true },
      );
    }).finally(() => {
      this.connecting = undefined;
    });
    await this.connecting;
    return this.initialized;
  }

  private initialized: any;

  async request(method: string, params: Record<string, any>, timeoutMs = 60000): Promise<any> {
    await this.connect();
    return this.rawRequest(method, params, timeoutMs);
  }

  async startThread(input: {
    cwd: string;
    profileInstructions: string;
    developerInstructions: string;
    mode: 'read-only' | 'workspace-write';
  }) {
    const sandbox = input.mode === 'read-only' ? 'read-only' : 'workspace-write';
    const started = await this.request('thread/start', {
      cwd: input.cwd,
      sandbox,
      approvalPolicy: 'never',
      baseInstructions: input.profileInstructions,
      developerInstructions: input.developerInstructions,
      experimentalRawEvents: true,
    });
    const threadId = started.thread.id as string;
    return {
      threadId,
      sessionId: started.thread.sessionId,
      cwd: started.cwd,
      instructionSources: started.instructionSources,
    };
  }

  async startTurn(input: { threadId: string; cwd: string; prompt: string; mode: 'read-only' | 'workspace-write' }) {
    const turnResponse = await this.request('turn/start', {
      threadId: input.threadId,
      cwd: input.cwd,
      input: [{ type: 'text', text: input.prompt, text_elements: [] }],
      approvalPolicy: 'never',
      sandboxPolicy:
        input.mode === 'read-only'
          ? { type: 'readOnly', networkAccess: false }
          : { type: 'workspaceWrite', writableRoots: [input.cwd], networkAccess: false },
    });
    return { turnId: turnResponse.turn.id };
  }

  async resumeThread(threadId: string) {
    const resumed = await this.request('thread/resume', { threadId, excludeTurns: false });
    return resumed.thread;
  }

  async sendMessage(threadId: string, message: string) {
    return this.request('turn/start', { threadId, input: [{ type: 'text', text: message, text_elements: [] }] });
  }

  async interrupt(threadId: string, turnId: string) {
    return this.request('turn/interrupt', { threadId, turnId });
  }

  async runCommand(cwd: string, command: string[], timeoutMs = 20000, write = false) {
    const result = await this.request(
      'command/exec',
      {
        cwd,
        command,
        timeoutMs,
        sandboxPolicy: write
          ? { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false }
          : { type: 'readOnly', networkAccess: false },
      },
      timeoutMs + 5000,
    );
    if (result.exitCode !== 0)
      throw new Error(`Command failed (${result.exitCode}): ${result.stderr || result.stdout}`);
    return result.stdout;
  }

  async resolveHostPath(path: string) {
    const resolved = (await this.runCommand(path, ['pwd', '-P'])).trim();
    if (!resolved.startsWith('/')) throw new Error('Host returned a non-absolute path');
    return resolved;
  }

  async createLocalBranch(cwd: string, branch: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(branch))
      throw new Error('Generated branch name contains unsupported characters');
    const gitDirectory = (await this.runCommand(cwd, ['git', 'rev-parse', '--absolute-git-dir'])).trim();
    const relativeGitDirectory = relative(resolve(cwd), resolve(gitDirectory));
    if (relativeGitDirectory.startsWith('..') || relativeGitDirectory === '')
      throw new Error('The repository Git directory must stay under the registered checkout');
    const result = await this.request(
      'command/exec',
      {
        cwd,
        command: ['git', 'switch', '-c', branch],
        timeoutMs: 30000,
        sandboxPolicy: { type: 'workspaceWrite', writableRoots: [cwd, gitDirectory], networkAccess: false },
      },
      35000,
    );
    if (result.exitCode !== 0)
      throw new Error(`Git could not create a task branch (${result.exitCode}): ${result.stderr || result.stdout}`);
    return result.stdout;
  }

  async answerQuestion(serverRequestId: string | number, questionId: string, answers: string[]) {
    return this.answerQuestions(serverRequestId, { [questionId]: { answers } });
  }

  async answerQuestions(serverRequestId: string | number, answers: Record<string, { answers: string[] }>) {
    await this.connect();
    this.socket!.send(JSON.stringify({ jsonrpc: '2.0', id: serverRequestId, result: { answers } }));
  }

  onModuleDestroy() {
    this.socket?.close();
    this.onClose();
  }

  private rawRequest(method: string, params: Record<string, any>, timeoutMs = 15000): Promise<any> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error('Codex app-server WebSocket is not connected'));
    const id = String(++this.id);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ jsonrpc: '2.0', id: Number(id), method, params }));
    });
  }

  private onMessage(raw: string) {
    let message: RpcMessage;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(String(message.id));
      if (message.error) pending.reject(new Error(message.error.message || 'Codex app-server request failed'));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) {
      this.events.emit(message.method, message);
      this.events.emit('notification', message);
      if (message.id !== undefined && message.method !== 'item/tool/requestUserInput') {
        const result = ['execCommandApproval', 'applyPatchApproval'].includes(message.method)
          ? { decision: { denied: { rejection: 'AgentPier does not grant interactive approvals automatically' } } }
          : { decision: 'decline' };
        this.socket?.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
      }
    }
  }

  private onClose() {
    this.socket = undefined;
    this.initialized = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Codex app-server WebSocket closed'));
    }
    this.pending.clear();
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
