import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentProfileService, AgentRole } from '../agents/agent-profile.service';
import { CodexAppServerService } from '../integrations/codex/codex-app-server.service';
import { ManagerService } from '../manager/manager.service';
import { BackupService } from '../backup/backup.service';
import { SessionService } from '../sessions/session.service';

type Step = {
  id: string;
  title: string;
  description: string;
  profile?: AgentRole;
  appId?: string;
  repositoryId?: string;
  dependsOn?: string[];
  checks?: string[];
};

@Injectable()
export class TaskOrchestratorService implements OnModuleInit {
  private readonly waiters = new Map<string, Array<(event: any) => void>>();
  private readonly terminalTurns = new Map<string, any>();

  constructor(
    private readonly records: ManagerService,
    private readonly profiles: AgentProfileService,
    private readonly codex: CodexAppServerService,
    private readonly backups: BackupService,
    private readonly sessionRecords: SessionService,
  ) {}

  async onModuleInit() {
    this.codex.events.on('notification', (event) => void this.handleCodexEvent(event));
    const active = (await this.records.list('session')).filter((row) =>
      ['running', 'waiting_for_user'].includes(row.data.status),
    );
    for (const session of active) await this.records.update(session.id, { ...session.data, attached: false });
  }

  async analyze(projectId: string, request: string) {
    const context = await this.records.getProjectContext(projectId);
    const apps = context.applications;
    if (!apps.length) throw new BadRequestException('Add the project applications before starting Codex analysis');
    const task = await this.records.create(
      'task',
      {
        name: request.slice(0, 240),
        originalRequest: request,
        status: 'analysis_running',
        analysisExpected: apps.length,
        draftPlan: null,
        approvedPlan: null,
        analysisResults: [],
        sessionIds: [],
        createdAt: new Date().toISOString(),
      },
      projectId,
    );
    void this.runAnalysis(task.id, context).catch((error) => this.failTask(task.id, error));
    return task;
  }

  async getAnalysisResults(taskId: string) {
    const task = await this.requireTask(taskId);
    const [sessions, messages] = await Promise.all([
      this.sessionRecords.forTask(taskId, task.projectId || undefined),
      this.records.list('agent-event', task.projectId || undefined),
    ]);
    const taskSessions = sessions.filter(
      (session) => session.data.taskId === taskId && session.data.phase === 'analysis',
    );
    const threadIds = new Set(taskSessions.map((session) => session.data.threadId));
    return {
      task,
      sessions: taskSessions,
      results: taskSessions.map((session) => ({
        sessionId: session.id,
        profile: session.data.profile,
        result: session.data.result,
        status: session.data.status,
      })),
      messages: messages.filter((message) => threadIds.has(message.data.threadId)),
    };
  }

  async execute(taskId: string) {
    const task = await this.requireTask(taskId);
    if (!['approved', 'blocked'].includes(task.data.status) || !task.data.approvedPlan)
      throw new BadRequestException(
        'Execution requires an explicitly approved plan; blocked approved tasks may be retried',
      );
    const availableProfiles = new Set((await this.profiles.list()).map((profile) => profile.role));
    const steps = this.normalizeSteps(task.data.approvedPlan.steps, availableProfiles);
    this.validateGraph(steps);
    const subtasks = await Promise.all(
      steps.map((step) =>
        this.records.create(
          'subtask',
          {
            ...step,
            taskId,
            attempt: Number(task.data.attempt || 0) + 1,
            status: 'queued',
            result: null,
            branch: null,
            profile: step.profile || 'backend',
            createdAt: new Date().toISOString(),
          },
          task.projectId || undefined,
        ),
      ),
    );
    await this.records.updateTask(taskId, {
      status: 'executing',
      subtaskIds: subtasks.map((item) => item.id),
      attempt: Number(task.data.attempt || 0) + 1,
      error: null,
      startedAt: new Date().toISOString(),
    });
    void this.executeGraph(taskId, steps, subtasks).catch((error) => this.failTask(taskId, error));
    return this.records.get(taskId);
  }

  async status(taskId: string) {
    const task = await this.requireTask(taskId);
    const [sessions, subtasks] = await Promise.all([
      this.sessionRecords.forTask(taskId, task.projectId || undefined),
      this.records.list('subtask', task.projectId || undefined),
    ]);
    const selected = (row: any) => row.data.taskId === taskId || task.data.subtaskIds?.includes(row.id);
    const taskSessions = sessions.filter(selected);
    for (const session of taskSessions) {
      if (['running', 'waiting_for_user'].includes(session.data.status) && !session.data.attached) {
        try {
          await this.codex.resumeThread(session.data.threadId);
          session.data = { ...session.data, attached: true };
          await this.records.update(session.id, session.data);
        } catch (error) {
          session.data = { ...session.data, reconnectReason: this.errorMessage(error) };
        }
      }
    }
    return { task, sessions: taskSessions, subtasks: subtasks.filter(selected) };
  }

  async messages(taskId: string) {
    await this.requireTask(taskId);
    return (await this.sessionRecords.messagesForTask(taskId)).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  async sendMessage(input: {
    taskId: string;
    sessionId: string;
    message?: string;
    questionMessageId?: string;
    answers?: Record<string, string[]>;
  }) {
    await this.requireTask(input.taskId);
    const session = await this.records.get(input.sessionId);
    if (session.kind !== 'session' || session.data.taskId !== input.taskId)
      throw new BadRequestException('Session does not belong to this task');
    if (input.questionMessageId) {
      const question = await this.records.get(input.questionMessageId);
      if (
        question.kind !== 'agent-message' ||
        question.data.taskId !== input.taskId ||
        !question.data.serverRequestId
      ) {
        throw new BadRequestException('The selected agent question is not awaiting an answer');
      }
      const expected = new Set((question.data.questions || []).map((item: any) => item.id));
      const answers = Object.fromEntries(
        Object.entries(input.answers || {})
          .filter(([id]) => expected.has(id))
          .map(([id, value]) => [id, { answers: value }]),
      );
      if (!Object.keys(answers).length)
        throw new BadRequestException('Provide an answer for at least one pending question');
      if (
        Object.values(input.answers || {})
          .flat()
          .some((answer) => this.containsCredential(answer))
      )
        throw new BadRequestException('Answers containing credential-like strings cannot be sent to an agent');
      await this.codex.answerQuestions(question.data.serverRequestId, answers);
      await this.records.update(question.id, {
        ...question.data,
        status: 'answered',
        answeredAt: new Date().toISOString(),
        answers: Object.keys(answers),
      });
      await this.records.update(session.id, { ...session.data, status: 'running' });
      return { sent: true, questionMessageId: question.id };
    }
    if (!input.message?.trim()) throw new BadRequestException('Message text is required');
    if (this.containsCredential(input.message))
      throw new BadRequestException('Messages containing credential-like strings cannot be sent to an agent');
    const turn = await this.codex.sendMessage(session.data.threadId, input.message);
    const turnId = turn.turn?.id;
    if (turnId) {
      session.data = { ...session.data, turnId, status: 'running' };
      await this.records.update(session.id, session.data);
    }
    const message = await this.records.create(
      'agent-message',
      {
        taskId: input.taskId,
        sessionId: session.id,
        threadId: session.data.threadId,
        direction: 'user_to_agent',
        text: input.message,
        status: 'sent',
        createdAt: new Date().toISOString(),
      },
      session.projectId || undefined,
    );
    return { message, turnId };
  }

  async cancel(taskId: string) {
    const task = await this.requireTask(taskId);
    await this.records.updateTask(taskId, { status: 'cancelled', cancelledAt: new Date().toISOString() });
    const sessions = await this.sessionRecords.forTask(taskId, task.projectId || undefined);
    for (const session of sessions) {
      if (session.data.turnId && ['running', 'waiting_for_user'].includes(session.data.status)) {
        try {
          await this.codex.interrupt(session.data.threadId, session.data.turnId);
        } catch {
          /* cancellation remains recorded */
        }
      }
      await this.records.update(session.id, {
        ...session.data,
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
      });
    }
    const subtasks = (await this.records.list('subtask', task.projectId || undefined)).filter(
      (row) => row.data.taskId === taskId && ['queued', 'running'].includes(row.data.status),
    );
    for (const subtask of subtasks) {
      await this.records.update(subtask.id, {
        ...subtask.data,
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
      });
    }
    return this.records.get(taskId);
  }

  async results(taskId: string) {
    const snapshot = await this.status(taskId);
    const repoIds = new Set(snapshot.subtasks.map((item: any) => item.data.repositoryId).filter(Boolean));
    const repos = await Promise.all([...repoIds].map((id) => this.records.get(String(id))));
    const changes = await Promise.all(
      repos.map(async (repo) => {
        try {
          const branch = (await this.codex.runCommand(repo.data.path, ['git', 'branch', '--show-current'])).trim();
          const status = await this.codex.runCommand(repo.data.path, ['git', 'status', '--short']);
          const diff = await this.codex.runCommand(repo.data.path, ['git', 'diff', '--stat']);
          return {
            repositoryId: repo.id,
            path: repo.data.path,
            remoteUrl: repo.data.remoteUrl,
            branch,
            status,
            diffStat: diff,
          };
        } catch (error) {
          return { repositoryId: repo.id, path: repo.data.path, error: this.errorMessage(error) };
        }
      }),
    );
    return { ...snapshot, changes };
  }

  private async runAnalysis(taskId: string, context: Awaited<ReturnType<ManagerService['getProjectContext']>>) {
    const task = await this.records.get(taskId);
    const request = task.data.originalRequest as string;
    const apps = context.applications;
    const developer = await readFile(join(process.cwd(), 'orchestrator/instructions.md'), 'utf8');
    const sessions: any[] = [];
    for (const app of apps) {
      if ((await this.requireTask(taskId)).data.status === 'cancelled') return;
      const role = this.profileFor(app.data);
      const profile = await this.profiles.load(role);
      const cwd = app.data.path as string;
      const developerInstructions = [
        developer,
        this.contextText(context),
        `Application: ${app.data.name || app.name}\nPurpose: ${app.data.purpose || ''}\nApplication path on Mac: ${cwd}`,
      ].join('\n\n');
      const started = await this.codex.startThread({
        cwd,
        profileInstructions: profile.profile + '\n\n' + profile.skills.map((skill) => skill.content).join('\n\n'),
        developerInstructions,
        mode: 'read-only',
      });
      const session = await this.records.create(
        'session',
        {
          taskId,
          phase: 'analysis',
          profile: role,
          applicationId: app.id,
          repositoryId: app.data.repositoryId || null,
          threadId: started.threadId,
          codexSessionId: started.sessionId,
          status: 'running',
          attached: true,
          instructionVersion: profile.version,
          projectInstructionVersions: this.instructionVersions(context),
          instructionSources: started.instructionSources,
          cwd,
          startedAt: new Date().toISOString(),
        },
        context.project.id,
      );
      sessions.push(session);
      if ((await this.requireTask(taskId)).data.status === 'cancelled') {
        await this.records.update(session.id, { ...session.data, status: 'cancelled' });
        return;
      }
      const prompt = `Perform a read-only architecture analysis for the user's request below. Do not edit files, switch branches, create files, or change configuration. Read the local AGENTS.md instructions and analyze relevant architecture, API contracts, dependencies, runtime, adjacent components, tests and risks. Return a concise findings report, relevant paths, questions, and implementation constraints.\n\nOriginal user request (verbatim):\n${request}\n\nApplication: ${app.data.name || app.name}\nPurpose: ${app.data.purpose || ''}`;
      const turn = await this.codex.startTurn({ threadId: started.threadId, cwd, prompt, mode: 'read-only' });
      await this.records.update(session.id, { ...session.data, turnId: turn.turnId });
      await this.records.updateTask(taskId, {
        sessionIds: sessions.map((item) => item.id),
        status: 'analysis_running',
      });
    }
    await this.records.updateTask(taskId, { sessionIds: sessions.map((item) => item.id), status: 'analysis_running' });
  }

  private async executeGraph(taskId: string, steps: Step[], records: any[]) {
    const projectId = (await this.requireTask(taskId)).projectId!;
    const pending = new Map(steps.map((step) => [step.id, step]));
    const completed = new Map<string, string>();
    const running = new Map<string, Promise<void>>();
    const repoLocks = new Set<string>();
    while (pending.size || running.size) {
      if ((await this.requireTask(taskId)).data.status === 'cancelled') return;
      const ready = [...pending.values()].filter((step) => (step.dependsOn || []).every((id) => completed.has(id)));
      for (const step of ready) {
        if (running.size >= 3) break;
        const subtask = records.find((item) => item.data.id === step.id || item.data.title === step.title);
        const path = await this.stepRepoPath(projectId, step);
        if (repoLocks.has(path)) continue;
        pending.delete(step.id);
        repoLocks.add(path);
        const promise = this.executeStep(taskId, projectId, step, subtask, path, Object.fromEntries(completed))
          .then((result) => {
            completed.set(step.id, result);
          })
          .finally(() => {
            repoLocks.delete(path);
            running.delete(step.id);
          });
        running.set(step.id, promise);
      }
      if (!running.size && pending.size)
        throw new BadRequestException('Plan dependencies contain a cycle or refer to unknown steps');
      if (running.size) await Promise.race(running.values());
    }
    if ((await this.requireTask(taskId)).data.status === 'cancelled') return;
    await this.records.updateTask(taskId, { status: 'review_ready', completedAt: new Date().toISOString() });
    await this.backups.createBackup('milestone');
  }

  private async executeStep(
    taskId: string,
    projectId: string,
    step: Step,
    subtask: any,
    path: string,
    dependencies: Record<string, string>,
  ) {
    if ((await this.requireTask(taskId)).data.status === 'cancelled')
      throw new Error('Task was cancelled before this step started');
    const role = step.profile || 'backend';
    const profile = await this.profiles.load(role);
    const repo = step.repositoryId ? await this.records.get(step.repositoryId) : null;
    const app = step.appId ? await this.records.get(step.appId) : null;
    const branch = `agentpier-task-${taskId.slice(0, 8)}-${this.slug(step.id)}`;
    const currentBranch = (await this.codex.runCommand(path, ['git', 'branch', '--show-current'])).trim();
    const porcelain = await this.codex.runCommand(path, [
      'git',
      'status',
      '--porcelain=v1',
      '--untracked-files=normal',
    ]);
    try {
      await this.codex.createLocalBranch(path, branch);
    } catch (error) {
      throw new Error(
        `Cannot create task branch without disturbing the current checkout (${currentBranch}): ${this.errorMessage(error)}`,
      );
    }
    await this.records.update(subtask.id, {
      ...subtask.data,
      status: 'running',
      branch,
      repositoryId: repo?.id,
      applicationId: app?.id,
      path,
      preexistingChanges: porcelain,
      startedAt: new Date().toISOString(),
    });
    const context = await this.records.getProjectContext(projectId);
    const developer = await readFile(join(process.cwd(), 'orchestrator/instructions.md'), 'utf8');
    const developerInstructions = [
      developer,
      this.contextText(context),
      `Only implement approved step "${step.title}". Preserve current uncommitted files shown before branch creation: ${porcelain || '(clean)'}. Do not push, commit, open PRs, or merge.`,
    ].join('\n\n');
    const started = await this.codex.startThread({
      cwd: path,
      profileInstructions: profile.profile + '\n\n' + profile.skills.map((skill) => skill.content).join('\n\n'),
      developerInstructions,
      mode: 'workspace-write',
    });
    const session = await this.records.create(
      'session',
      {
        taskId,
        subtaskId: subtask.id,
        phase: 'execution',
        profile: role,
        applicationId: app?.id || null,
        repositoryId: repo?.id || null,
        threadId: started.threadId,
        codexSessionId: started.sessionId,
        status: 'running',
        attached: true,
        branch,
        instructionVersion: profile.version,
        projectInstructionVersions: this.instructionVersions(context),
        instructionSources: started.instructionSources,
        cwd: path,
        startedAt: new Date().toISOString(),
      },
      projectId,
    );
    await this.records.update(subtask.id, {
      ...subtask.data,
      status: 'running',
      branch,
      sessionId: session.id,
      threadId: started.threadId,
    });
    if ((await this.requireTask(taskId)).data.status === 'cancelled') {
      await this.records.update(session.id, { ...session.data, status: 'cancelled' });
      await this.records.update(subtask.id, { ...subtask.data, status: 'cancelled' });
      return 'Task cancelled';
    }
    const dependencyText = Object.entries(dependencies)
      .map(([key, result]) => `\nDependency ${key} result:\n${result}`)
      .join('\n');
    const prompt = `Implement this approved task step.\n\nTask: ${step.title}\n\nApproved scope:\n${step.description}\n\nRequired checks:\n${(step.checks || []).join('\n')}\n\nCurrent API/contract and completed dependency results:\n${dependencyText || '(No dependencies)'}\n\nFollow local project instructions. Run relevant checks, update changelog/API documentation when the approved plan asks. Leave changes in the local working tree for user review.`;
    const turn = await this.codex.startTurn({ threadId: started.threadId, cwd: path, prompt, mode: 'workspace-write' });
    session.data = { ...session.data, turnId: turn.turnId };
    await this.records.update(session.id, session.data);
    if ((await this.requireTask(taskId)).data.status === 'cancelled') {
      try {
        await this.codex.interrupt(started.threadId, turn.turnId);
      } catch {
        /* cancellation is already recorded */
      }
      await this.records.update(session.id, { ...session.data, status: 'cancelled' });
      await this.records.update(subtask.id, { ...subtask.data, status: 'cancelled' });
      return 'Task cancelled';
    }
    const terminal = await this.waitForTurn(started.threadId, turn.turnId, 60 * 60 * 1000);
    if (terminal.turn?.status !== 'completed')
      throw new Error(`Codex execution ${terminal.turn?.status || 'failed'} for ${step.title}`);
    const status = await this.codex.runCommand(path, ['git', 'status', '--short']);
    const diff = await this.codex.runCommand(path, ['git', 'diff', '--stat']);
    const result = this.extractText(terminal.turn);
    const latestSubtask: any = await this.records.get(subtask.id);
    await this.records.update(subtask.id, {
      ...latestSubtask.data,
      status: 'completed',
      result,
      changes: status,
      diffStat: diff,
      completedAt: new Date().toISOString(),
    });
    return result || `Branch ${branch}; status:\n${status}\n${diff}`;
  }

  private async handleCodexEvent(event: any) {
    const method = event.method;
    const params = this.redact(event.params || {});
    const sessions = await this.records.list('session');
    const session = sessions.find((row) => row.data.threadId === params.threadId);
    if (!session) return;
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
          questions: params.questions,
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
        session.projectId || undefined,
      );
      session.data = { ...session.data, status: 'waiting_for_user' };
      await this.records.update(session.id, session.data);
      return;
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
          text: params.delta,
          status: 'streaming',
          createdAt: new Date().toISOString(),
        },
        session.projectId || undefined,
      );
      return;
    }
    if (method === 'turn/completed') {
      const turn = params.turn;
      const status =
        turn?.status === 'completed' ? 'completed' : turn?.status === 'interrupted' ? 'cancelled' : 'failed';
      session.data = {
        ...session.data,
        status,
        result: this.extractText(turn),
        completedAt: new Date().toISOString(),
        error: turn?.error || null,
      };
      await this.records.update(session.id, session.data);
      this.terminalTurns.set(turn.id, { turn });
      for (const resolve of this.waiters.get(turn.id) || []) resolve({ turn });
      this.waiters.delete(turn.id);
      if (session.data.phase === 'analysis') await this.maybeCompleteAnalysis(session.data.taskId);
    }
  }

  private async maybeCompleteAnalysis(taskId: string) {
    const task = await this.requireTask(taskId);
    const sessions = (await this.records.list('session', task.projectId || undefined)).filter(
      (row) => row.data.taskId === taskId && row.data.phase === 'analysis',
    );
    if (
      sessions.length === Number(task.data.analysisExpected || 0) &&
      sessions.every((row) => ['completed', 'failed', 'cancelled'].includes(row.data.status))
    ) {
      const failed = sessions.some((row) => row.data.status === 'failed');
      await this.records.updateTask(taskId, {
        status: failed ? 'blocked' : 'analysis_complete',
        analysisResults: sessions.map((row) => ({
          sessionId: row.id,
          role: row.data.profile,
          result: row.data.result,
          status: row.data.status,
        })),
        analysisCompletedAt: new Date().toISOString(),
      });
      if (!failed) await this.backups.createBackup('milestone');
    }
  }

  private async waitForTurn(threadId: string, turnId: string, timeoutMs: number) {
    const known = this.terminalTurns.get(turnId);
    if (known) return known;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Codex turn timed out after ${timeoutMs}ms`)), timeoutMs);
      const complete = (event: any) => {
        clearTimeout(timer);
        resolve(event);
      };
      const list = this.waiters.get(turnId) || [];
      list.push(complete);
      this.waiters.set(turnId, list);
    });
  }

  private normalizeSteps(value: unknown, availableProfiles: Set<string>): Step[] {
    if (!Array.isArray(value) || !value.length)
      throw new BadRequestException('The approved plan must contain a non-empty steps array');
    return value.map((raw, index) => {
      if (!raw || typeof raw !== 'object' || typeof raw.title !== 'string' || typeof raw.description !== 'string')
        throw new BadRequestException(`Plan step ${index + 1} needs title and description`);
      const role = raw.profile || 'backend';
      if (!availableProfiles.has(role)) throw new BadRequestException(`Unknown agent profile: ${role}`);
      return { ...raw, id: raw.id || `step-${index + 1}`, profile: role, dependsOn: raw.dependsOn || [] } as Step;
    });
  }

  private validateGraph(steps: Step[]) {
    const ids = new Set(steps.map((step) => step.id));
    if (ids.size !== steps.length) throw new BadRequestException('Plan step IDs must be unique');
    for (const step of steps)
      for (const dep of step.dependsOn || [])
        if (!ids.has(dep) || dep === step.id) throw new BadRequestException(`Invalid dependency ${dep} in ${step.id}`);
  }

  private async stepRepoPath(projectId: string, step: Step) {
    const row = step.repositoryId
      ? await this.records.get(step.repositoryId)
      : step.appId
        ? await this.records.get(step.appId)
        : null;
    if (!row || !['app', 'repository'].includes(row.kind) || row.projectId !== projectId)
      throw new BadRequestException(`Step ${step.id} must reference a registered application or repository`);
    return row.data.path as string;
  }

  private async requireTask(id: string) {
    const task = await this.records.get(id);
    if (task.kind !== 'task') throw new BadRequestException('taskId must refer to a task');
    return task;
  }

  private profileFor(data: Record<string, any>): AgentRole {
    if (typeof data.profile === 'string' && /^[a-z0-9][a-z0-9-]{0,40}$/.test(data.profile)) return data.profile;
    return /front|portal|web|ui|angular|react|ios|android/i.test(`${data.name || ''} ${data.purpose || ''}`)
      ? 'frontend'
      : 'backend';
  }

  private contextText(context: any) {
    return `Confirmed project context and registered applications:\n${JSON.stringify({ project: context.project.data, instructions: context.instructions.map((x: any) => x.data), confirmedMemory: context.confirmedMemory.map((x: any) => x.data), applications: context.applications.map((x: any) => x.data), repositories: context.repositories.map((x: any) => x.data) })}`;
  }

  private instructionVersions(context: any) {
    return context.instructions.map((row: any) => ({
      id: row.id,
      version: createHash('sha256')
        .update(String(row.data.content || row.data.instructions || ''))
        .digest('hex'),
    }));
  }

  private extractText(turn: any): string {
    const results: string[] = [];
    for (const item of turn?.items || []) {
      if (item.type === 'agentMessage' && typeof item.text === 'string') results.push(item.text);
      else if (item.type === 'agentMessage' && Array.isArray(item.content))
        results.push(item.content.map((part: any) => part.text || '').join(''));
    }
    return this.redact(results.join('\n\n')).slice(0, 50000);
  }

  private async failTask(taskId: string, error: unknown) {
    try {
      const task: any = await this.records.get(taskId);
      if (task.data.status === 'cancelled') return;
      const reason = this.errorMessage(error);
      await this.records.updateTask(taskId, {
        status: 'blocked',
        error: reason,
        failedAt: new Date().toISOString(),
      });
      const [sessions, subtasks] = await Promise.all([
        this.records.list('session', task.projectId || undefined),
        this.records.list('subtask', task.projectId || undefined),
      ]);
      for (const session of sessions.filter((row) => row.data.taskId === taskId && row.data.status === 'running')) {
        if (session.data.turnId) {
          try {
            await this.codex.interrupt(String(session.data.threadId), String(session.data.turnId));
          } catch {
            /* the saved error remains available if the session already stopped */
          }
        }
        await this.records.update(session.id, { ...session.data, status: 'failed', error: reason });
      }
      for (const subtask of subtasks.filter((row) => row.data.taskId === taskId && row.data.status === 'running')) {
        await this.records.update(subtask.id, { ...subtask.data, status: 'blocked', error: reason });
      }
    } catch {
      /* task may not have been written */
    }
  }

  private containsCredential(text: string) {
    return /(\bsk-[A-Za-z0-9_-]{12,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAKIA[A-Z0-9]{16}\b|\b(?:password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*\S+)/i.test(
      text,
    );
  }
  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown orchestration error';
  }
  private slug(text: string) {
    return (
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 32) || 'step'
    );
  }
  private redact(value: any): any {
    if (Array.isArray(value)) return value.map((child) => this.redact(child));
    if (!value || typeof value !== 'object')
      return typeof value === 'string'
        ? value
            .replace(/\bsk-[A-Za-z0-9_-]{12,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAKIA[A-Z0-9]{16}\b/g, '[REDACTED]')
            .replace(/\b(password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
        : value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/(password|secret|token|credential|api[_-]?key)/i.test(key))
        .map(([key, child]) => [key, this.redact(child)]),
    );
  }
}
