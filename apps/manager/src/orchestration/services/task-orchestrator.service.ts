import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { isAbsolute } from 'node:path';
import { AgentProfileService } from '../../agents/services/agent-profile.service';
import { Step } from '../types/orchestration-step.type';
import { CodexAppServerService } from '../../integrations/codex/services/codex-app-server.service';
import { ManagerService } from '../../manager/services/manager.service';
import { SessionService } from '../../sessions/services/session.service';
import { CodexSessionCoordinatorService } from './codex-session-coordinator.service';
import { DispatchAnalysisDto } from '../../tasks/dto/dispatch-analysis.dto';
import { ManagedAgentSessionService } from './managed-agent-session.service';

const TASK_ANALYSIS_RECORD_LIMIT = 500;

@Injectable()
export class TaskOrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(TaskOrchestratorService.name);
  private readonly sessionCoordinator: CodexSessionCoordinatorService;
  private readonly managedSessions: ManagedAgentSessionService;
  constructor(
    private readonly records: ManagerService,
    private readonly profiles: AgentProfileService,
    private readonly codex: CodexAppServerService,
    private readonly sessionRecords: SessionService,
    sessionCoordinator?: CodexSessionCoordinatorService,
    managedSessions?: ManagedAgentSessionService,
  ) {
    this.sessionCoordinator =
      sessionCoordinator && typeof (sessionCoordinator as any).handleEvent === 'function'
        ? sessionCoordinator
        : new CodexSessionCoordinatorService(records);
    this.managedSessions =
      managedSessions || new ManagedAgentSessionService(records, profiles, codex, this.sessionCoordinator);
  }

  async onModuleInit() {
    this.codex.events.on('notification', (event) => this.handleNotification(event));
    await this.sessionCoordinator.detachActiveSessions();
  }

  private handleNotification(event: any) {
    void this.handleCodexEvent(event).catch(() => {
      this.logger.error('Failed to process a Codex app-server notification');
    });
  }

  async analyze(projectId: string, request: string) {
    const task = await this.records.create(
      'task',
      {
        name: request.slice(0, 240),
        originalRequest: request,
        status: 'pending_action',
        draftPlan: null,
        approvedPlan: null,
        analysisResults: [],
        sessionIds: [],
        createdAt: new Date().toISOString(),
      },
      projectId,
    );
    return task;
  }

  async getAnalysisResults(taskId: string) {
    const task = await this.requireTask(taskId);
    const candidateSessions = await this.sessionRecords.forTask(
      taskId,
      task.projectId || undefined,
      TASK_ANALYSIS_RECORD_LIMIT + 1,
      'analysis',
    );
    const sessionsTruncated = candidateSessions.length > TASK_ANALYSIS_RECORD_LIMIT;
    const taskSessions = candidateSessions.slice(0, TASK_ANALYSIS_RECORD_LIMIT);
    return {
      task,
      sessions: taskSessions,
      results: taskSessions.map((session) => ({
        sessionId: session.id,
        profile: session.data.profile,
        result: session.data.result,
        status: session.data.status,
      })),
      sessionsTruncated,
    };
  }

  async dispatchAnalysis(input: DispatchAnalysisDto) {
    const task = await this.requireTask(input.taskId);
    const application: any = await this.records.get(input.appId);
    if (application.kind !== 'app' || application.projectId !== task.projectId)
      throw new BadRequestException('appId must identify an application registered in this task project');
    const repositoryId = input.repositoryId || application.data.repositoryId;
    const step: Step = {
      id: `analysis-${Date.now()}`,
      title: 'Read-only analysis',
      description: input.focus,
      targetBranch: '',
      appId: application.id,
      repositoryId,
      profile: input.profile,
      workingDirectory: input.workingDirectory,
      dependsOn: [],
      skills: input.skills,
    };
    const path = await this.stepRepoPath(task.projectId!, step);
    let started;
    try {
      started = await this.requireManagedSessions().startAnalysis(
        task,
        application,
        input.profile,
        repositoryId,
        path,
        input.focus,
        input.skills,
      );
    } catch (error) {
      const reason = this.errorMessage(error);
      await this.records.updateTask(task.id, {
        analysisDispatchError: reason,
        analysisDispatchFailedAt: new Date().toISOString(),
        error: reason,
      });
      throw error;
    }
    const sessionIds = Array.isArray(task.data.sessionIds) ? task.data.sessionIds : [];
    await this.records.updateTask(task.id, { sessionIds: [...sessionIds, started.session.id] });
    return {
      taskId: task.id,
      sessionId: started.session.id,
      threadId: started.session.data.threadId,
      profile: started.profile,
      appId: application.id,
      cwd: path,
      status: started.status,
      ...(started.error ? { error: started.error } : {}),
    };
  }

  async execute(taskId: string, decision: string) {
    const task = await this.requireTask(taskId);
    if (!task.data.approvedPlan) throw new BadRequestException('Execution requires an explicitly approved plan');
    if (typeof decision !== 'string' || !decision.trim())
      throw new BadRequestException('The orchestrator execution decision is required');
    return this.records.updateTask(taskId, {
      status: 'executing',
      executionDecision: decision.trim(),
      executionStartedAt: new Date().toISOString(),
    });
  }

  async dispatchAssignment(taskId: string, stepId: string, dependencies: Record<string, any>) {
    const task = await this.requireTask(taskId);
    const step = task.data.approvedPlan?.steps?.find((candidate: any) => candidate.id === stepId);
    if (!step) throw new BadRequestException('stepId must identify an assignment in the explicitly approved plan');
    if (typeof step.profile !== 'string' || !step.profile.trim())
      throw new BadRequestException('The orchestrator must select a profile explicitly for the assignment');
    if ((!step.appId && !step.repositoryId) || !step.targetBranch)
      throw new BadRequestException('The approved assignment must select an application/repository and target branch');
    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies))
      throw new BadRequestException('dependencies must be an object of orchestrator-selected context');
    const path = await this.stepRepoPath(task.projectId!, step);
    const branch = step.targetBranch;
    let subtask: any;
    try {
      const previous = (await this.records.list('subtask', task.projectId || undefined)).filter(
        (row: any) => row.data.taskId === taskId && row.data.id === stepId,
      );
      subtask = await this.records.create(
        'subtask',
        {
          ...step,
          taskId,
          attempt: previous.reduce((max: number, row: any) => Math.max(max, Number(row.data.attempt || 0)), 0) + 1,
          status: 'queued',
          result: null,
          createdAt: new Date().toISOString(),
        },
        task.projectId || undefined,
      );
      const subtaskIds = Array.isArray(task.data.subtaskIds) ? task.data.subtaskIds : [];
      await this.records.updateTask(taskId, { subtaskIds: [...new Set([...subtaskIds, subtask.id])] });
      const execution = await this.executeStep(taskId, task.projectId!, step, subtask, path, dependencies);
      return {
        taskId,
        subtaskId: subtask.id,
        profile: step.profile,
        applicationId: step.appId,
        cwd: path,
        targetBranch: branch,
        status: execution?.status || 'running',
      };
    } catch (error) {
      if (!subtask) throw error;
      const latest: any = await this.records.get(subtask.id);
      await this.records.update(subtask.id, {
        ...latest.data,
        status: 'blocked',
        error: this.errorMessage(error),
        failedAt: new Date().toISOString(),
      });
      return { taskId, subtaskId: subtask.id, status: 'blocked', error: this.errorMessage(error) };
    }
  }

  async completeFromEvidence(
    taskId: string,
    subtaskId: string,
    result: string,
    evidence: string[],
    userConfirmed: boolean,
  ) {
    if (userConfirmed !== true) throw new BadRequestException('Explicit user confirmation is required');
    await this.requireTask(taskId);
    const subtask: any = await this.records.get(subtaskId);
    if (subtask.kind !== 'subtask' || subtask.data.taskId !== taskId)
      throw new BadRequestException('subtaskId must refer to a subtask of this task');
    const normalizedEvidence = evidence.map((item) => item.trim()).filter(Boolean);
    if (normalizedEvidence.some((item) => item.length > 2000))
      throw new BadRequestException('Each evidence item must be at most 2,000 characters');
    if (!normalizedEvidence.length) throw new BadRequestException('At least one verified result or check is required');

    const reconciled = await this.records.update(subtaskId, {
      ...subtask.data,
      status: 'completed',
      outcomeStatus: 'completed',
      retryable: false,
      completionEvidence: { source: 'user-confirmed-external-verification', evidence: normalizedEvidence },
      result: `${result.trim()}\n\nVerified externally:\n${normalizedEvidence.map((item) => `- ${item}`).join('\n')}`,
      error: null,
      finishedAt: new Date().toISOString(),
    });
    return reconciled;
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
          await this.sessionCoordinator.updateSession(session.id, session.data);
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
      await this.sessionCoordinator.updateSession(session.id, { ...session.data, status: 'running' });
      return { sent: true, questionMessageId: question.id };
    }
    if (!input.message?.trim()) throw new BadRequestException('Message text is required');
    if (this.containsCredential(input.message))
      throw new BadRequestException('Messages containing credential-like strings cannot be sent to an agent');
    const runtime = await this.profiles.resolveRuntime({
      defaultModel: session.data.effectiveModel || session.data.model || null,
      defaultReasoningEffort: session.data.effectiveReasoningEffort || session.data.reasoningEffort || 'medium',
    });
    const turn = await this.codex.sendMessage(session.data.threadId, input.message, runtime);
    const turnId = turn.turn?.id;
    if (turnId) {
      session.data = {
        ...session.data,
        turnId,
        status: 'running',
        effectiveModel: runtime.model,
        effectiveReasoningEffort: runtime.effort,
      };
      await this.sessionCoordinator.updateSession(session.id, session.data);
    }
    const message = await this.sessionCoordinator.createMessage(
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
      await this.sessionCoordinator.updateSession(session.id, {
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

  async readTask(taskId: string) {
    const task = await this.requireTask(taskId);
    return {
      task,
      plan: task.data.approvedPlan || task.data.draftPlan || null,
      analysisResults: task.data.analysisResults || [],
      results: task.data.results || [],
      decisions: task.data.orchestratorDecisions || [],
    };
  }

  async recordDecision(taskId: string, decision: string) {
    if (typeof decision !== 'string' || !decision.trim() || decision.length > 20000)
      throw new BadRequestException('decision must contain 1 to 20,000 characters');
    const task = await this.requireTask(taskId);
    const decisions = Array.isArray(task.data.orchestratorDecisions) ? task.data.orchestratorDecisions : [];
    return this.records.updateTask(taskId, {
      orchestratorDecisions: [...decisions, { decision: decision.trim(), recordedAt: new Date().toISOString() }],
    });
  }

  async recordAssignmentOutcome(
    taskId: string,
    subtaskId: string,
    status: 'completed' | 'partial' | 'blocked',
    outcome: string,
    evidence: string[],
  ) {
    if (typeof outcome !== 'string' || !outcome.trim() || outcome.length > 20000)
      throw new BadRequestException('outcome must contain 1 to 20,000 characters');
    if (
      !['completed', 'partial', 'blocked'].includes(status) ||
      !Array.isArray(evidence) ||
      !evidence.length ||
      evidence.some((item) => typeof item !== 'string' || !item.trim() || item.length > 2000)
    )
      throw new BadRequestException(
        'status must be completed, partial, or blocked and evidence must contain non-empty strings up to 2,000 characters',
      );
    const task = await this.requireTask(taskId);
    const subtask: any = await this.records.get(subtaskId);
    if (subtask.kind !== 'subtask' || subtask.data.taskId !== taskId)
      throw new BadRequestException('subtaskId must belong to taskId');
    const approvedStep = task.data.approvedPlan?.steps?.find((step: any) => step.id === subtask.data.id);
    const assignmentIds = Array.isArray(task.data.subtaskIds) ? task.data.subtaskIds : [];
    if (!approvedStep || !assignmentIds.includes(subtaskId))
      throw new BadRequestException('subtaskId must identify a dispatched assignment for an approved plan step');
    return this.records.update(subtaskId, {
      ...subtask.data,
      status,
      outcomeStatus: status,
      retryable: status !== 'completed',
      orchestratorOutcome: {
        text: outcome.trim(),
        evidence: evidence.map((item) => item.trim()),
        recordedAt: new Date().toISOString(),
      },
    });
  }

  async recordTaskStatus(
    taskId: string,
    status:
      | 'pending_action'
      | 'analysis_running'
      | 'analysis_complete'
      | 'plan_draft'
      | 'approved'
      | 'executing'
      | 'review_ready'
      | 'completed'
      | 'blocked'
      | 'cancelled',
    decision: string,
  ) {
    const allowed = [
      'pending_action',
      'analysis_running',
      'analysis_complete',
      'plan_draft',
      'approved',
      'executing',
      'review_ready',
      'completed',
      'blocked',
      'cancelled',
    ];
    if (!allowed.includes(status) || !decision.trim() || decision.length > 20000)
      throw new BadRequestException('status and a decision of 1 to 20,000 characters are required');
    await this.requireTask(taskId);
    return this.records.updateTask(taskId, { status, statusDecision: decision.trim() });
  }

  private async executeStep(
    taskId: string,
    projectId: string,
    step: Step,
    subtask: any,
    path: string,
    dependencies: Record<string, any>,
  ) {
    if ((await this.requireTask(taskId)).data.status === 'cancelled')
      throw new Error('Task was cancelled before this step started');
    if (typeof step.profile !== 'string' || !step.profile.trim())
      throw new BadRequestException('The approved assignment must select an agent profile');
    return this.requireManagedSessions().startExecution(taskId, projectId, step, subtask, path, dependencies);
  }

  private requireManagedSessions() {
    return this.managedSessions;
  }

  private async handleCodexEvent(event: any) {
    const handled = await this.sessionCoordinator.handleEvent(event);
    const session = handled?.session;
    if (session?.data.phase !== 'execution' || !session.data.subtaskId || !handled?.terminal?.turn) return;
    const subtask: any = await this.records.get(session.data.subtaskId);
    const result = String(session.data.result || '');
    const completed = handled.terminal.turn.status === 'completed';
    const changes = completed
      ? await Promise.all([
          this.codex
            .runCommand(session.data.cwd, ['git', 'status', '--short'])
            .catch((error) => this.errorMessage(error)),
          this.codex.runCommand(session.data.cwd, ['git', 'diff', '--stat']).catch((error) => this.errorMessage(error)),
        ])
      : [];
    await this.records.update(subtask.id, {
      ...subtask.data,
      status: completed ? 'awaiting_outcome' : 'blocked',
      result,
      ...(completed ? { changes: changes[0], diffStat: changes[1], workerCompletedAt: new Date().toISOString() } : {}),
      ...(completed ? {} : { error: session.data.error || 'Codex worker turn did not complete', retryable: true }),
    });
  }

  private async stepRepoPath(projectId: string, step: Step) {
    if (step.workingDirectory === 'repository' && !step.repositoryId)
      throw new BadRequestException(`Step ${step.id} selects the repository root but has no repositoryId`);
    if (step.workingDirectory === 'application' && !step.appId)
      throw new BadRequestException(`Step ${step.id} selects an application directory but has no appId`);
    const repository = step.repositoryId ? await this.records.get(step.repositoryId) : null;
    const application = step.appId ? await this.records.get(step.appId) : null;
    if (
      (step.repositoryId && (!repository || repository.kind !== 'repository' || repository.projectId !== projectId)) ||
      (step.appId && (!application || application.kind !== 'app' || application.projectId !== projectId))
    )
      throw new BadRequestException(
        `Step ${step.id} must reference a registered application or repository in this project`,
      );
    const useRepository = step.workingDirectory === 'repository';
    const row = useRepository ? repository : application || repository;
    if (!row) throw new BadRequestException(`Step ${step.id} must reference a registered application or repository`);
    const path = row.data?.path;
    if (typeof path !== 'string' || !isAbsolute(path)) {
      const selected = useRepository ? 'repository' : 'application';
      throw new BadRequestException(
        `Step ${step.id} selects a ${selected} without a valid absolute registered path; update the project record before dispatch`,
      );
    }
    return path;
  }

  private async requireTask(id: string) {
    const task = await this.records.get(id);
    if (task.kind !== 'task') throw new BadRequestException('taskId must refer to a task');
    return task;
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
        await this.sessionCoordinator.updateSession(session.id, { ...session.data, status: 'failed', error: reason });
      }
      for (const subtask of subtasks.filter(
        (row) => row.data.taskId === taskId && ['queued', 'running'].includes(row.data.status),
      )) {
        await this.records.update(subtask.id, { ...subtask.data, status: 'blocked', retryable: true, error: reason });
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
    const message = error instanceof Error ? error.message : 'Unknown orchestration error';
    return this.redact(message);
  }
  private redact(value: any): any {
    if (Array.isArray(value)) return value.map((child) => this.redact(child));
    if (!value || typeof value !== 'object')
      return typeof value === 'string'
        ? value
            .replace(/\bsk-[A-Za-z0-9_-]{12,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAKIA[A-Z0-9]{16}\b/g, '[REDACTED]')
            .replace(
              /\b(password|passwd|secret|token|api[_-]?key|authorization|private[_-]?key)\s*[:=]\s*\S+/gi,
              '$1=[REDACTED]',
            )
            .replace(
              /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
              '[REDACTED PRIVATE KEY]',
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
