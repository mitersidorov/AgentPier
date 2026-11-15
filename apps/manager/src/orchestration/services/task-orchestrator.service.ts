import { validReleaseOperations } from '../../tasks/types/release-operation.type';
import { selectSkills, skillEvidence } from '../../agents/services/skill-selection';
import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AgentProfileService } from '../../agents/services/agent-profile.service';
import { AgentRole } from '../../agents/types/agent-role.type';
import { Step } from '../types/orchestration-step.type';
import { CodexAppServerService } from '../../integrations/codex/services/codex-app-server.service';
import { ManagerService } from '../../manager/services/manager.service';
import { BackupService } from '../../backup/services/backup.service';
import { SessionService } from '../../sessions/services/session.service';

@Injectable()
export class TaskOrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(TaskOrchestratorService.name);
  private readonly waiters = new Map<string, Array<(event: any) => void>>();
  private readonly terminalTurns = new Map<string, any>();
  private readonly activeWritePaths = new Set<string>();

  constructor(
    private readonly records: ManagerService,
    private readonly profiles: AgentProfileService,
    private readonly codex: CodexAppServerService,
    private readonly backups: BackupService,
    private readonly sessionRecords: SessionService,
  ) {}

  async onModuleInit() {
    this.codex.events.on('notification', (event) => this.handleNotification(event));
    const active = (await this.records.list('session')).filter((row) =>
      ['running', 'waiting_for_user'].includes(row.data.status),
    );
    for (const session of active) await this.records.update(session.id, { ...session.data, attached: false });
  }

  private handleNotification(event: any) {
    void this.handleCodexEvent(event).catch(() => {
      this.logger.error('Failed to process a Codex app-server notification');
    });
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
    let task = await this.requireTask(taskId);
    if (!['approved', 'blocked', 'review_ready'].includes(task.data.status) || !task.data.approvedPlan)
      throw new BadRequestException(
        'Execution requires an explicitly approved plan; blocked tasks and legacy completed refusals may be retried',
      );
    const availableProfiles = new Set((await this.profiles.list()).map((profile) => profile.role));
    const steps = this.normalizeSteps(task.data.approvedPlan.steps, availableProfiles);
    this.validateGraph(steps);
    const previous = (await this.records.list('subtask', task.projectId || undefined))
      .filter((row: any) => row.data.taskId === taskId)
      .sort(
        (a: any, b: any) =>
          Number(b.data.attempt || 0) - Number(a.data.attempt || 0) ||
          String(b.data.createdAt || '').localeCompare(String(a.data.createdAt || '')),
      );
    const latestByStep = new Map<string, any>();
    for (const item of previous) if (!latestByStep.has(item.data.id)) latestByStep.set(item.data.id, item);
    await this.finalizeMissingMarker(taskId, steps, latestByStep);
    const failedLegacy = [...latestByStep.values()].filter(
      (item: any) => item.data.status === 'completed' && this.isRefusalResult(String(item.data.result || '')),
    );
    if (task.data.status === 'review_ready' && failedLegacy.length) {
      for (const item of failedLegacy)
        await this.records.update(item.id, {
          ...item.data,
          status: 'blocked',
          outcomeStatus: 'blocked',
          retryable: true,
          error: 'Legacy turn completed with a refusal instead of completing the assigned step',
        });
      task = await this.records.updateTask(taskId, {
        status: 'blocked',
        error: 'A prior step returned a refusal but was recorded as completed; retrying only incomplete steps',
      });
    }
    if (task.data.status === 'review_ready')
      throw new BadRequestException('The approved plan already finished; only blocked or refused steps can be retried');
    if (task.data.status === 'blocked') await this.assertNoActiveTaskSessions(taskId, task.projectId || undefined);
    const reusable = new Set(
      [...latestByStep.values()].filter((item: any) => this.isReusableSuccess(item)).map((item: any) => item.data.id),
    );
    const created = await Promise.all(
      steps
        .filter((step) => !reusable.has(step.id))
        .map((step) =>
          this.records.create(
            'subtask',
            {
              ...step,
              taskId,
              attempt: Number(task.data.attempt || 0) + 1,
              status: 'queued',
              result: null,
              branch: null,
              profile: step.profile || 'backend-nestjs',
              createdAt: new Date().toISOString(),
            },
            task.projectId || undefined,
          ),
        ),
    );
    let createdIndex = 0;
    const subtasks = steps.map((step) => {
      if (reusable.has(step.id)) return latestByStep.get(step.id);
      return created[createdIndex++];
    });
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

  async completeFromEvidence(
    taskId: string,
    subtaskId: string,
    result: string,
    evidence: string[],
    userConfirmed: boolean,
  ) {
    if (userConfirmed !== true) throw new BadRequestException('Explicit user confirmation is required');
    const task = await this.requireTask(taskId);
    if (!['blocked', 'cancelled'].includes(task.data.status) || !task.data.approvedPlan)
      throw new BadRequestException('Only a blocked or cancelled task with an approved plan can be reconciled');
    await this.assertNoActiveTaskSessions(taskId, task.projectId || undefined);
    const subtask: any = await this.records.get(subtaskId);
    if (
      subtask.kind !== 'subtask' ||
      subtask.data.taskId !== taskId ||
      !['blocked', 'cancelled'].includes(subtask.data.status)
    )
      throw new BadRequestException('subtaskId must refer to an incomplete subtask of this task');
    if (!task.data.approvedPlan.steps?.some((step: any) => step.id === subtask.data.id))
      throw new BadRequestException('The subtask does not match a step in the approved plan');
    const normalizedEvidence = evidence.map((item) => item.trim()).filter(Boolean);
    if (!normalizedEvidence.length) throw new BadRequestException('At least one verified result or check is required');

    const reconciled = await this.records.update(subtaskId, {
      ...subtask.data,
      status: 'completed',
      outcomeStatus: 'completed',
      retryable: false,
      completionEvidence: { source: 'user-confirmed-external-verification', evidence: normalizedEvidence },
      result: `${result.trim()}\n\nVerified externally:\n${normalizedEvidence.map((item) => `- ${item}`).join('\n')}\n\nAGENTPIER_RESULT: completed`,
      error: null,
      finishedAt: new Date().toISOString(),
    });
    const allSubtasks = (await this.records.list('subtask', task.projectId || undefined)).filter(
      (item: any) => item.data.taskId === taskId,
    );
    const latestByStep = new Map<string, any>();
    for (const item of allSubtasks.sort(
      (a: any, b: any) =>
        Number(b.data.attempt || 0) - Number(a.data.attempt || 0) ||
        String(b.data.createdAt || '').localeCompare(String(a.data.createdAt || '')),
    ))
      if (!latestByStep.has(item.data.id)) latestByStep.set(item.data.id, item.id === subtaskId ? reconciled : item);
    const allComplete = task.data.approvedPlan.steps.every((step: any) =>
      this.isReusableSuccess(latestByStep.get(step.id)),
    );
    return this.records.updateTask(taskId, {
      status: allComplete ? 'review_ready' : 'blocked',
      subtaskIds: task.data.approvedPlan.steps.map((step: any) => latestByStep.get(step.id)?.id).filter(Boolean),
      error: allComplete ? null : 'Verified subtask completed; other approved steps remain incomplete',
      ...(allComplete ? { completedAt: new Date().toISOString() } : {}),
    });
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
      const skills = selectSkills(
        profile.skills,
        'analysis',
        request,
        `${app.data.name || ''} ${app.data.purpose || ''}`,
      );
      const runtime = await this.profiles.resolveRuntime(profile);
      const cwd = app.data.path as string;
      const developerInstructions = [
        developer,
        this.contextText(context),
        `Application: ${app.data.name || app.name}\nPurpose: ${app.data.purpose || ''}\nApplication path on Mac: ${cwd}`,
      ].join('\n\n');
      const started = await this.codex.startThread({
        cwd,
        profileInstructions: profile.profile + '\n\n' + skills.map((skill) => skill.content).join('\n\n'),
        developerInstructions,
        mode: 'read-only',
        model: runtime.model,
      });
      const session = await this.records.create(
        'session',
        {
          taskId,
          phase: 'analysis',
          profile: role,
          model: runtime.model,
          effectiveModel: runtime.model,
          reasoningEffort: runtime.effort,
          effectiveReasoningEffort: runtime.effort,
          selectedSkills: skillEvidence(skills),
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
      const turn = await this.codex.startTurn({
        threadId: started.threadId,
        cwd,
        prompt,
        mode: 'read-only',
        ...runtime,
      });
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
    const completedRecords = new Map(
      records.filter((item) => this.isReusableSuccess(item)).map((item) => [item.data.id, item]),
    );
    const pending = new Map(steps.filter((step) => !completedRecords.has(step.id)).map((step) => [step.id, step]));
    const completed = new Map([...completedRecords].map(([id, item]) => [id, String(item.data.result || '')]));
    const running = new Map<string, Promise<void>>();
    let waitingForActivePath = false;
    while (pending.size || running.size) {
      if ((await this.requireTask(taskId)).data.status === 'cancelled') return;
      waitingForActivePath = false;
      const ready = [...pending.values()].filter((step) => (step.dependsOn || []).every((id) => completed.has(id)));
      for (const step of ready) {
        if (running.size >= 3) break;
        const subtask = records.find((item) => item.data.id === step.id || item.data.title === step.title);
        const path = await this.stepRepoPath(projectId, step);
        if ([...this.activeWritePaths].some((activePath) => this.pathsOverlap(activePath, path))) {
          waitingForActivePath = true;
          continue;
        }
        await this.assertNoActivePathSessions(projectId, path, taskId, subtask?.id);
        pending.delete(step.id);
        this.activeWritePaths.add(path);
        const promise = this.executeStep(
          taskId,
          projectId,
          step,
          subtask,
          path,
          Object.fromEntries((step.dependsOn || []).map((id) => [id, completed.get(id)!])),
        )
          .then((result) => {
            completed.set(step.id, result);
          })
          .finally(() => {
            this.activeWritePaths.delete(path);
            running.delete(step.id);
          });
        running.set(step.id, promise);
      }
      if (!running.size && pending.size) {
        if (waitingForActivePath)
          throw new BadRequestException('A plan step overlaps another active managed session; retry after it finishes');
        throw new BadRequestException('Plan dependencies contain a cycle or refer to unknown steps');
      }
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
    const role = step.profile || 'backend-nestjs';
    const profile = await this.profiles.load(role);
    const repo = step.repositoryId ? await this.records.get(step.repositoryId) : null;
    const app = step.appId ? await this.records.get(step.appId) : null;
    const skills = selectSkills(
      profile.skills,
      'execution',
      `${step.title} ${step.description}`,
      `${app?.data.name || ''} ${app?.data.purpose || ''}`,
    );
    const currentBranch = (await this.codex.runCommand(path, ['git', 'branch', '--show-current'])).trim();
    const branch = step.targetBranch;
    if (branch !== currentBranch)
      throw new BadRequestException(
        `The approved target branch "${branch}" is not checked out (current: "${currentBranch}"). AgentPier will not switch branches; check out the requested branch and retry.`,
      );
    const porcelain = await this.codex.runCommand(path, [
      'git',
      'status',
      '--porcelain=v1',
      '--untracked-files=normal',
    ]);
    const dockerSocketPath = step.executionCapabilities?.includes('docker')
      ? await this.codex.localDockerSocketPath(path)
      : undefined;
    await this.records.update(subtask.id, {
      ...subtask.data,
      status: 'running',
      branch,
      repositoryId: repo?.id,
      applicationId: app?.id,
      path,
      executionCapabilities: step.executionCapabilities || [],
      preexistingChanges: porcelain,
      startedAt: new Date().toISOString(),
    });
    const context = await this.records.getProjectContext(projectId);
    const developer = await readFile(join(process.cwd(), 'orchestrator/instructions.md'), 'utf8');
    const releaseHandoff = step.releaseOperations
      ? `Explicitly approved release operations (only these targets): ${JSON.stringify(step.releaseOperations)}. All other publication operations remain forbidden. Preserve unrelated work; inspect the exact staged diff before committing. Report blocked operations, never bypass sandbox restrictions.`
      : 'Do not push, commit, open PRs, submit reviews, or merge.';
    const applicationContext =
      app && app.data.path && resolve(path) === resolve(app.data.path)
        ? `Application: ${app.data.name || app.name} (${app.id})\nPurpose: ${app.data.purpose || ''}\nApplication working directory: ${path}`
        : app
          ? `Application: repository-level integration step associated with ${app.data.name || app.name} (${app.id})\nWorking directory: ${path}`
          : `Application: repository-level integration step\nWorking directory: ${path}`;
    const repositoryContext = repo
      ? `Repository: ${repo.data.name || repo.name} (${repo.id})\nRepository root: ${repo.data.path}`
      : `Repository: ${path}`;
    const managedContext = [
      `Persisted AgentPier task ID: ${taskId}`,
      `Persisted subtask ID: ${subtask.id}`,
      `Step ID: ${step.id}`,
      `Attempt: ${Number(subtask.data.attempt || 1)}`,
      `Agent profile: ${role}`,
      applicationContext,
      repositoryContext,
      `Target branch: ${branch}`,
      `Current working directory: ${path}`,
      `Approved execution capabilities: ${(step.executionCapabilities || []).join(', ') || 'none'}`,
    ].join('\n');
    const developerInstructions = [
      developer,
      this.contextText(context),
      `Managed execution context (already persisted and approved):\n${managedContext}`,
      `Only implement approved step "${step.title}" on the explicitly approved target branch ${branch}. Do not create or switch branches. Preserve pre-existing uncommitted changes: ${porcelain || '(clean)'}. ${releaseHandoff}`,
      'This managed step is already part of a persisted, user-approved plan. Do not call AgentPier MCP tools such as execute_task or get_task_status, and do not ask the user to repeat either ID or the plan approval. Work directly in the supplied application directory and run the local checks listed in the task.',
      dockerSocketPath
        ? `This approved step has local Docker capability through the configured Unix socket ${dockerSocketPath}. Use the repository Compose files and preserve existing volumes; never run destructive volume removal unless the approved step explicitly requires it.`
        : 'No Docker host capability was approved for this step. Do not attempt to access the host Docker socket.',
    ].join('\n\n');
    const runtime = await this.profiles.resolveRuntime(profile);
    const started = await this.codex.startThread({
      cwd: path,
      profileInstructions: profile.profile + '\n\n' + skills.map((skill) => skill.content).join('\n\n'),
      developerInstructions,
      mode: 'workspace-write',
      model: runtime.model,
    });
    const session = await this.records.create(
      'session',
      {
        taskId,
        subtaskId: subtask.id,
        phase: 'execution',
        releaseOperations: step.releaseOperations || null,
        profile: role,
        model: runtime.model,
        effectiveModel: runtime.model,
        reasoningEffort: runtime.effort,
        effectiveReasoningEffort: runtime.effort,
        selectedSkills: skillEvidence(skills),
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
    const dependencyText = (step.dependsOn || [])
      .map(
        (key) =>
          `\nDependency contract:\n${JSON.stringify({ stepId: key, status: 'completed', summary: this.redact(dependencies[key] || '').slice(0, 4000), truncated: (dependencies[key] || '').length > 4000 })}`,
      )
      .join('\n');
    const prompt = `Implement this approved task step.\n\nTask: ${step.title}\n\nApproved scope:\n${step.description}\n\nRequired checks:\n${(step.checks || []).join('\n')}\n\nCurrent API/contract and completed dependency results:\n${dependencyText || '(No dependencies)'}\n\nFollow local project instructions. Run relevant checks, update changelog/API documentation when the approved plan asks. Leave changes in the local working tree for user review. Do not call AgentPier MCP execute_task or get_task_status; this subtask is already running under its approved parent plan. Finish with exactly one line: AGENTPIER_RESULT: completed, AGENTPIER_RESULT: partial, or AGENTPIER_RESULT: blocked. Use completed only when the assigned scope and required checks are complete; use partial or blocked for refusals, permission failures, or incomplete work.`;
    const turn = await this.codex.startTurn({
      threadId: started.threadId,
      cwd: path,
      prompt,
      mode: 'workspace-write',
      releaseOperations: step.releaseOperations,
      dockerSocketPath,
      ...runtime,
    });
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
    const result = this.extractText(terminal.turn);
    const outcomeStatus = this.agentResultStatus(result);
    if (outcomeStatus !== 'completed') {
      const reason = outcomeStatus
        ? `Agent reported ${outcomeStatus} instead of completing the approved step`
        : 'Agent did not provide the required AGENTPIER_RESULT completion status';
      const latestSession: any = await this.records.get(session.id);
      await this.records.update(session.id, {
        ...latestSession.data,
        status: 'blocked',
        turnStatus: terminal.turn.status,
        outcomeStatus: outcomeStatus || 'blocked',
        error: reason,
      });
      const latestSubtask: any = await this.records.get(subtask.id);
      await this.records.update(subtask.id, {
        ...latestSubtask.data,
        status: 'blocked',
        outcomeStatus: outcomeStatus || 'blocked',
        retryable: true,
        result,
        error: reason,
        finishedAt: new Date().toISOString(),
      });
      throw new Error(reason);
    }
    const status = await this.codex.runCommand(path, ['git', 'status', '--short']);
    const diff = await this.codex.runCommand(path, ['git', 'diff', '--stat']);
    const latestSubtask: any = await this.records.get(subtask.id);
    await this.records.update(subtask.id, {
      ...latestSubtask.data,
      status: 'completed',
      outcomeStatus: 'completed',
      retryable: false,
      result,
      changes: status,
      diffStat: diff,
      completedAt: new Date().toISOString(),
    });
    return result || `Branch ${branch}; status:\n${status}\n${diff}`;
  }

  private async handleCodexEvent(event: any) {
    const method = event.method;
    const rawParams = event.params || {};
    const params = this.redact(rawParams);
    const sessions = await this.records.list('session');
    const session = sessions.find((row) => row.data.threadId === params.threadId);
    if (!session) return;
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
      // A failed journal write must not prevent safe lifecycle processing.
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
          text: this.redact(rawParams.delta),
          status: 'streaming',
          createdAt: new Date().toISOString(),
        },
        session.projectId || undefined,
      );
      return;
    }
    if (method === 'turn/completed' || method === 'turn/error') {
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
        result: this.redact(this.extractText(turn)),
        completedAt: new Date().toISOString(),
        error: this.redact(turn?.error) || null,
      };
      await this.records.update(session.id, session.data);
      const safeTurn = {
        ...turn,
        id: turnId,
        status,
        error: this.redact(turn?.error),
        items: this.redact(turn?.items),
      };
      if (turnId) {
        this.terminalTurns.set(turnId, { turn: safeTurn });
        for (const resolve of this.waiters.get(turnId) || []) resolve({ turn: safeTurn });
        this.waiters.delete(turnId);
      }
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
      if (raw.releaseOperations !== undefined && !validReleaseOperations(raw.releaseOperations))
        throw new BadRequestException('Invalid approved releaseOperations scope');
      if (
        raw.executionCapabilities !== undefined &&
        (!Array.isArray(raw.executionCapabilities) ||
          raw.executionCapabilities.some((capability: unknown) => capability !== 'docker') ||
          new Set(raw.executionCapabilities).size !== raw.executionCapabilities.length)
      )
        throw new BadRequestException('executionCapabilities may only contain the unique capability "docker"');
      if (raw.workingDirectory !== undefined && !['application', 'repository'].includes(raw.workingDirectory))
        throw new BadRequestException('workingDirectory must be application or repository');
      const dockerComposeCheck =
        Array.isArray(raw.checks) &&
        raw.checks.some((check: unknown) => typeof check === 'string' && /^\s*docker\s+compose\b/i.test(check));
      const executionCapabilities = [...(raw.executionCapabilities || [])] as Array<'docker'>;
      if (dockerComposeCheck && !executionCapabilities.includes('docker')) executionCapabilities.push('docker');
      const role = this.canonicalProfile(raw.profile || 'backend-nestjs');
      if (!availableProfiles.has(role)) throw new BadRequestException(`Unknown agent profile: ${role}`);
      if (!this.isSafeTargetBranch(raw.targetBranch))
        throw new BadRequestException(
          `Plan step ${index + 1} requires an explicit targetBranch. Ask the user which branch to use and wait before execution; never choose or create one automatically.`,
        );
      return {
        ...raw,
        id: raw.id || `step-${index + 1}`,
        profile: role,
        dependsOn: raw.dependsOn || [],
        executionCapabilities,
        workingDirectory: raw.workingDirectory || (dockerComposeCheck ? 'repository' : undefined),
      } as Step;
    });
  }

  private isSafeTargetBranch(value: unknown) {
    return (
      typeof value === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(value) &&
      !value.includes('..') &&
      !value.includes('//') &&
      !value.endsWith('/') &&
      !value.endsWith('.') &&
      !value.includes('@{')
    );
  }

  private validateGraph(steps: Step[]) {
    const ids = new Set(steps.map((step) => step.id));
    if (ids.size !== steps.length) throw new BadRequestException('Plan step IDs must be unique');
    for (const step of steps)
      for (const dep of step.dependsOn || [])
        if (!ids.has(dep) || dep === step.id) throw new BadRequestException(`Invalid dependency ${dep} in ${step.id}`);
  }

  private async stepRepoPath(projectId: string, step: Step) {
    const hasDockerComposeCheck = (step.checks || []).some((check) => /^\s*docker\s+compose\b/i.test(check));
    if (step.workingDirectory === 'repository' && !step.repositoryId)
      throw new BadRequestException(`Step ${step.id} selects the repository root but has no repositoryId`);
    if (step.workingDirectory === 'application' && !step.appId)
      throw new BadRequestException(`Step ${step.id} selects an application directory but has no appId`);
    const useRepository =
      Boolean(step.repositoryId) &&
      (step.workingDirectory === 'repository' || (step.workingDirectory !== 'application' && hasDockerComposeCheck));
    const row = useRepository
      ? await this.records.get(step.repositoryId!)
      : step.appId
        ? await this.records.get(step.appId)
        : step.repositoryId
          ? await this.records.get(step.repositoryId)
          : null;
    if (!row || !['app', 'repository'].includes(row.kind) || row.projectId !== projectId)
      throw new BadRequestException(`Step ${step.id} must reference a registered application or repository`);
    return row.data.path as string;
  }

  private agentResultStatus(result: string): 'completed' | 'partial' | 'blocked' | null {
    const match = result.match(/^AGENTPIER_RESULT:\s*(completed|partial|blocked)\s*$/im);
    return (match?.[1] as 'completed' | 'partial' | 'blocked' | undefined) || null;
  }

  private async finalizeMissingMarker(taskId: string, steps: Step[], latestByStep: Map<string, any>) {
    const task = await this.requireTask(taskId);
    for (const step of steps) {
      const subtask = latestByStep.get(step.id);
      if (subtask?.data?.status !== 'blocked' || this.agentResultStatus(String(subtask.data.result || ''))) continue;
      if (
        !/required AGENTPIER_RESULT|completion marker|completion status/i.test(
          String(subtask.data.error || task.data.error || ''),
        )
      )
        continue;

      const sessionId = subtask.data.sessionId;
      if (!sessionId) continue;
      const session: any = await this.records.get(sessionId);
      if (
        session.kind !== 'session' ||
        session.data.taskId !== taskId ||
        session.data.status !== 'completed' ||
        !session.data.threadId ||
        session.data.cwd !== subtask.data.path
      )
        continue;

      const runtime = await this.profiles.resolveRuntime({
        defaultModel: session.data.effectiveModel || session.data.model || null,
        defaultReasoningEffort: session.data.effectiveReasoningEffort || session.data.reasoningEffort || 'medium',
      });
      const role = step.profile || 'backend-nestjs';
      const profile = await this.profiles.load(role);
      const started = await this.codex.startThread({
        cwd: subtask.data.path,
        profileInstructions: `${profile.profile}\n\n${profile.skills.map((skill: any) => skill.content).join('\n\n')}`,
        developerInstructions: [
          'This is a separate, read-only finalization session. The original implementation turn has ended. Do not implement, edit, commit, push, create a PR, merge, or run browser/E2E checks.',
          `Persisted task ID: ${taskId}; subtask ID: ${subtask.id}; step ID: ${step.id}; profile: ${role}.`,
          `Application: ${subtask.data.applicationId || step.appId || ''}; repository: ${subtask.data.repositoryId || ''}; application working directory: ${subtask.data.path}; approved branch: ${step.targetBranch}.`,
          'The current turn exists only to inspect the existing report and working tree, summarize checks already performed (including checks performed locally outside the agent sandbox), distinguish environment failures from product failures, and provide the required final marker.',
        ].join('\n\n'),
        mode: 'read-only',
        model: runtime.model,
      });
      const prompt = [
        'This is a report-only review of a previously completed managed step. Do not repeat implementation, edit files, or rerun browser/E2E checks.',
        `Persisted task ID: ${taskId}; subtask ID: ${subtask.id}; step ID: ${step.id}; profile: ${step.profile}.`,
        `Repository: ${subtask.data.repositoryId || ''}; application: ${subtask.data.applicationId || step.appId || ''}; working directory: ${subtask.data.path}; approved branch: ${step.targetBranch}.`,
        `Your prior turn produced work but omitted its required completion marker. Prior report:\n${String(subtask.data.result || '(empty)').slice(0, 10000)}`,
        'Inspect the existing report and current working tree read-only. If the report records approved checks run locally outside this session, count those as evidence and do not repeat them. Separate tool/session failures from product failures. State completed checks and any environment limitation. Do not commit, push, create a PR, or merge.',
        'If the approved work is complete and its checks are supported by the report/current files, finish with exactly: AGENTPIER_RESULT: completed. If material work or required evidence is missing, explain it and finish with AGENTPIER_RESULT: partial or AGENTPIER_RESULT: blocked.',
      ].join('\n\n');
      const finalizationSession: any = await this.records.create(
        'session',
        {
          taskId,
          subtaskId: subtask.id,
          phase: 'finalization',
          profile: role,
          model: runtime.model,
          effectiveModel: runtime.model,
          reasoningEffort: runtime.effort,
          effectiveReasoningEffort: runtime.effort,
          applicationId: session.data.applicationId || step.appId || null,
          repositoryId: session.data.repositoryId || step.repositoryId || null,
          threadId: started.threadId,
          codexSessionId: started.sessionId,
          status: 'running',
          attached: true,
          cwd: subtask.data.path,
          finalizationOnly: true,
          startedAt: new Date().toISOString(),
        },
        task.projectId || undefined,
      );
      const turn = await this.codex.startTurn({
        threadId: started.threadId,
        cwd: subtask.data.path,
        prompt,
        mode: 'read-only',
        ...runtime,
      });
      finalizationSession.data = { ...finalizationSession.data, turnId: turn.turnId };
      await this.records.update(finalizationSession.id, finalizationSession.data);
      await this.records.update(subtask.id, { ...subtask.data, status: 'running', finalizationOnly: true });
      const terminal = await this.waitForTurn(started.threadId, turn.turnId, 20 * 60 * 1000);
      const result = this.extractText(terminal.turn);
      const outcomeStatus = terminal.turn?.status === 'completed' ? this.agentResultStatus(result) : null;
      const completed = outcomeStatus === 'completed';
      const message = completed
        ? null
        : outcomeStatus
          ? `Agent reported ${outcomeStatus} while reconciling the completed step`
          : 'Finalization turn failed or omitted its required completion marker';
      await this.records.update(finalizationSession.id, {
        ...finalizationSession.data,
        status: terminal.turn?.status === 'completed' ? 'completed' : 'failed',
        result: this.redact(result),
        finalizationOnly: true,
        completedAt: new Date().toISOString(),
        error: message,
      });
      const reconciled = await this.records.update(subtask.id, {
        ...subtask.data,
        status: completed ? 'completed' : 'blocked',
        outcomeStatus: completed ? 'completed' : outcomeStatus || 'blocked',
        retryable: !completed,
        result: [String(subtask.data.result || ''), 'Final status report:', result].filter(Boolean).join('\n\n'),
        completionEvidence: completed ? 'agent-finalization-report' : undefined,
        error: message,
        finishedAt: new Date().toISOString(),
      });
      latestByStep.set(step.id, reconciled);
      if (!completed) throw new BadRequestException(message || 'The managed step remains incomplete');
    }
  }

  private isRefusalResult(result: string) {
    const status = this.agentResultStatus(result);
    if (status) return status !== 'completed';
    return /\b(?:can(?:not|['’]t)|could not|unable to|blocked|requires? approval|approval policy is never|did not start|was(?: not|n['’]t) provided|please provide (?:the )?(?:persisted )?task id|have not modified|haven['’]t modified)\b/i.test(
      result,
    );
  }

  private isReusableSuccess(subtask: any) {
    if (subtask?.data?.status !== 'completed') return false;
    if (subtask.data.outcomeStatus === 'completed') return true;
    const result = String(subtask.data.result || '');
    return Boolean(result.trim()) && !this.isRefusalResult(result);
  }

  private pathsOverlap(left: string, right: string) {
    const a = resolve(left);
    const b = resolve(right);
    const aToB = relative(a, b);
    const bToA = relative(b, a);
    const inside = (path: string) =>
      path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
    return inside(aToB) || inside(bToA);
  }

  private async assertNoActiveTaskSessions(taskId: string, projectId?: string) {
    const sessions = await this.sessionRecords.forTask(taskId, projectId);
    const active = sessions.filter((session) => ['running', 'waiting_for_user'].includes(session.data.status));
    if (active.length)
      throw new BadRequestException(
        'Cannot retry while prior task sessions are still active; stop or resolve them first',
      );
  }

  private async assertNoActivePathSessions(projectId: string, path: string, taskId: string, subtaskId?: string) {
    const [sessions, subtasks] = await Promise.all([
      this.records.list('session', projectId),
      this.records.list('subtask', projectId),
    ]);
    const activeSessions = sessions.filter(
      (session: any) =>
        ['running', 'waiting_for_user'].includes(session.data.status) &&
        typeof session.data.cwd === 'string' &&
        this.pathsOverlap(path, String(session.data.cwd || '')),
    );
    const activeSubtasks = subtasks.filter(
      (subtask: any) =>
        subtask.id !== subtaskId &&
        subtask.data.taskId !== taskId &&
        subtask.data.status === 'running' &&
        subtask.data.path &&
        this.pathsOverlap(path, String(subtask.data.path)),
    );
    if (activeSessions.length || activeSubtasks.length)
      throw new BadRequestException(`Cannot start work in ${path}: an overlapping managed session is already running`);
  }

  private async requireTask(id: string) {
    const task = await this.records.get(id);
    if (task.kind !== 'task') throw new BadRequestException('taskId must refer to a task');
    return task;
  }

  private profileFor(data: Record<string, any>): AgentRole {
    if (typeof data.profile === 'string' && /^[a-z0-9][a-z0-9-]{0,40}$/.test(data.profile))
      return this.canonicalProfile(data.profile);
    return /front|portal|web|ui|angular|react|ios|android/i.test(`${data.name || ''} ${data.purpose || ''}`)
      ? 'frontend-angular'
      : 'backend-nestjs';
  }

  private canonicalProfile(role: string): string {
    if (role === 'backend') return 'backend-nestjs';
    if (role === 'frontend') return 'frontend-angular';
    return role;
  }

  private contextText(context: any) {
    const projectMetadata = Object.fromEntries(
      Object.entries(context.project.data || {}).filter(([key]) => key !== 'instructions' && key !== 'constraints'),
    );
    return `Confirmed project context and registered applications:\n${JSON.stringify({ project: projectMetadata, instructions: context.instructions.map((x: any) => ({ ...x.data, id: x.id })), confirmedMemory: context.confirmedMemory.map((x: any) => x.data), applications: context.applications.map((x: any) => x.data), repositories: context.repositories.map((x: any) => x.data) })}`;
  }

  private instructionVersions(context: any) {
    return context.instructions.map((row: any) => ({
      id: row.id,
      version: row.data.version || 1,
      contentHash:
        row.data.contentHash ||
        createHash('sha256')
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
