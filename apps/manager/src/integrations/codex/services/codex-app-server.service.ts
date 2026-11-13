import { ReleaseOperation, validReleaseOperations } from '../../../tasks/types/release-operation.type';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { RpcMessage } from '../types/rpc-message.type';
import { HttpService } from '../../../common/http/services/http.service';
import { LoggingService } from '../../../common/logging/services/logging.service';
import { EventEmitter } from 'node:events';
import { relative, resolve } from 'node:path';

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

  constructor(
    private readonly http: HttpService,
    private readonly logger: LoggingService,
  ) {}

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
          this.logger.info('Codex app-server WebSocket connected', { url: this.url });
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
    model?: string;
  }) {
    const sandbox = input.mode === 'read-only' ? 'read-only' : 'workspace-write';
    const started = await this.request('thread/start', {
      cwd: input.cwd,
      sandbox,
      approvalPolicy: 'never',
      ...(input.model ? { model: input.model } : {}),
      baseInstructions: input.profileInstructions,
      developerInstructions: input.developerInstructions,
      experimentalRawEvents: true,
    });
    const threadId = started.thread.id as string;
    return {
      threadId,
      model: started.model,
      reasoningEffort: started.reasoningEffort,
      sessionId: started.thread.sessionId,
      cwd: started.cwd,
      instructionSources: started.instructionSources,
    };
  }

  async listModels(): Promise<
    Array<{
      id: string;
      displayName: string;
      isDefault: boolean;
      supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
      defaultReasoningEffort: string | null;
    }>
  > {
    const models: Array<{
      id: string;
      displayName: string;
      isDefault: boolean;
      supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
      defaultReasoningEffort: string | null;
    }> = [];
    let cursor: string | undefined;
    do {
      const result = await this.request('model/list', { ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(result?.data)) throw new Error('Codex app-server returned an invalid model/list response');
      models.push(
        ...result.data
          .filter((model: any) => typeof model?.model === 'string' && model.model.length > 0)
          .map((model: any) => ({
            id: model.model,
            displayName: typeof model.displayName === 'string' ? model.displayName : model.model,
            isDefault: model.isDefault === true,
            supportedReasoningEfforts: Array.isArray(model.supportedReasoningEfforts)
              ? model.supportedReasoningEfforts
                  .filter((option: any) => typeof option?.reasoningEffort === 'string')
                  .map((option: any) => ({
                    reasoningEffort: option.reasoningEffort,
                    description: typeof option.description === 'string' ? option.description : '',
                  }))
              : [],
            defaultReasoningEffort:
              typeof model.defaultReasoningEffort === 'string' ? model.defaultReasoningEffort : null,
          })),
      );
      cursor = typeof result.nextCursor === 'string' ? result.nextCursor : undefined;
    } while (cursor);
    return models;
  }

  async startTurn(input: {
    threadId: string;
    cwd: string;
    prompt: string;
    mode: 'read-only' | 'workspace-write';
    model?: string;
    effort?: string;
    releaseOperations?: ReleaseOperation[];
  }) {
    if (input.releaseOperations !== undefined && input.mode !== 'workspace-write')
      throw new Error('Release scope requires workspace-write execution');
    const releasePolicy =
      input.releaseOperations === undefined ? undefined : await this.releasePolicy(input.cwd, input.releaseOperations);
    const turnResponse = await this.request('turn/start', {
      threadId: input.threadId,
      ...(input.model ? { model: input.model } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
      cwd: input.cwd,
      input: [{ type: 'text', text: input.prompt, text_elements: [] }],
      approvalPolicy: 'never',
      sandboxPolicy:
        input.mode === 'read-only'
          ? { type: 'readOnly', networkAccess: false }
          : releasePolicy || { type: 'workspaceWrite', writableRoots: [input.cwd], networkAccess: false },
    });
    return { turnId: turnResponse.turn.id };
  }

  async resumeThread(threadId: string) {
    const resumed = await this.request('thread/resume', { threadId, excludeTurns: false });
    return resumed.thread;
  }

  async sendMessage(threadId: string, message: string, runtime?: { model: string; effort: string }) {
    return this.request('turn/start', {
      threadId,
      ...runtime,
      input: [{ type: 'text', text: message, text_elements: [] }],
    });
  }

  async interrupt(threadId: string, turnId: string) {
    return this.request('turn/interrupt', { threadId, turnId });
  }

  async stopTurnAndWait(threadId: string, turnId: string, timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    const request = async (method: string, params: Record<string, any>) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Timed out confirming Codex turn termination');
      let timer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          this.request(method, params, remaining),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Timed out confirming Codex turn termination')), remaining);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    let interrupted = false;
    while (true) {
      // Read rollout history instead of trusting local status, including detached sessions.
      const result = await request('thread/read', { threadId, includeTurns: true });
      const turns = result?.thread?.turns;
      const turn = Array.isArray(turns) ? turns.find((candidate: any) => candidate.id === turnId) : undefined;
      if (!turn || !['completed', 'interrupted', 'inProgress'].includes(turn.status) || turn.error)
        throw new Error('Cannot confirm Codex turn termination: failed or unknown turn state');
      if (turns.some((candidate: any) => candidate.id !== turnId && candidate.status === 'inProgress'))
        throw new Error('Cannot confirm Codex turn termination: another turn is active');
      if (turn.status === 'completed' || turn.status === 'interrupted') return;
      if (!interrupted) {
        await request('turn/interrupt', { threadId, turnId });
        interrupted = true;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Timed out confirming Codex turn termination');
      await new Promise((resolve) => setTimeout(resolve, Math.min(250, remaining)));
    }
  }

  async runCommand(
    cwd: string,
    command: string[],
    timeoutMs = 20000,
    write = false,
    releaseOperations?: ReleaseOperation[],
  ) {
    const releasePolicy =
      releaseOperations === undefined ? undefined : await this.releasePolicy(cwd, releaseOperations);
    const result = await this.request(
      'command/exec',
      {
        cwd,
        command,
        timeoutMs,
        sandboxPolicy:
          releasePolicy ||
          (write
            ? { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false }
            : { type: 'readOnly', networkAccess: false }),
      },
      timeoutMs + 5000,
    );
    if (result.exitCode !== 0)
      throw new Error(`Command failed (${result.exitCode}): ${result.stderr || result.stdout}`);
    return result.stdout;
  }

  private async releasePolicy(cwd: string, operations: ReleaseOperation[]) {
    if (!validReleaseOperations(operations)) throw new Error('Invalid release operation scope');
    // Resolve on the Mac host, not inside Manager. Never accept a caller-provided Git path.
    const checkout = await this.resolveHostPath(cwd);
    const top = (await this.runCommand(checkout, ['git', 'rev-parse', '--show-toplevel'])).trim();
    if ((await this.resolveHostPath(top)) !== checkout)
      throw new Error('Release scope requires the registered checkout root');
    const gitPath = (await this.runCommand(checkout, ['git', 'rev-parse', '--absolute-git-dir'])).trim();
    if (!gitPath.startsWith('/')) throw new Error('Git directory must be absolute');
    const gitDirectory = await this.resolveHostPath(gitPath);
    const inside = relative(checkout, gitDirectory);
    if (!inside || inside === '..' || inside.startsWith('../') || inside.startsWith('/'))
      throw new Error(
        'Release Git directory must stay under the registered checkout; external worktrees are unsupported',
      );
    const common = (
      await this.runCommand(checkout, ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'])
    ).trim();
    if ((await this.resolveHostPath(common)) !== gitDirectory)
      throw new Error('Release scope does not support shared Git directories');
    return { type: 'workspaceWrite', writableRoots: [checkout, gitDirectory], networkAccess: true };
  }

  async resolveHostPath(path: string) {
    if (!path.startsWith('/') || /[\r\n]/.test(path)) throw new Error('Host path must be absolute');
    const resolved = (await this.runCommand(path, ['pwd', '-P'])).trim();
    if (!resolved.startsWith('/') || /[\r\n]/.test(resolved)) throw new Error('Host returned a non-absolute path');
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
    this.logger.warn('Codex app-server WebSocket closed');
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
      const response = await this.http.request({ method: 'GET', url, timeout: 2500, retries: 0 });
      return { ok: response.status >= 200 && response.status < 300, status: response.status };
    } catch {
      return { ok: false, status: undefined };
    }
  }
}
