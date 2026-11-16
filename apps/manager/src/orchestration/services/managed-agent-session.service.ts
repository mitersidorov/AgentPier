import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { selectSkills, skillEvidence } from '../../agents/services/skill-selection';
import { AgentProfileService } from '../../agents/services/agent-profile.service';
import { CodexAppServerService } from '../../integrations/codex/services/codex-app-server.service';
import { ManagerService } from '../../manager/services/manager.service';
import { CodexSessionCoordinatorService } from './codex-session-coordinator.service';
import { Step } from '../types/orchestration-step.type';

// Starts profile-selected Codex sessions and persists their execution context.
@Injectable()
export class ManagedAgentSessionService {
  constructor(
    private readonly records: ManagerService,
    private readonly profiles: AgentProfileService,
    private readonly codex: CodexAppServerService,
    private readonly sessionCoordinator: CodexSessionCoordinatorService,
  ) {}

  async startAnalysis(
    task: any,
    application: any,
    profileRole: string,
    repositoryId: string | undefined,
    cwd: string,
    focus: string,
    skillNames?: string[],
  ) {
    const profile = await this.profiles.load(profileRole);
    const skills = selectSkills(profile.skills, skillNames);
    const context = await this.records.getProjectContext(task.projectId);
    const developer = await this.instructions();
    const developerInstructions = [
      developer,
      this.contextText(context),
      `Persisted AgentPier task ID: ${task.id}`,
      `Analysis profile: ${profile.role}`,
      `Selected application: ${application.data.name || application.name} (${application.id})`,
      `Absolute working directory: ${cwd}`,
      `Analysis focus: ${focus}`,
      `User request: ${task.data.originalRequest}`,
      'This is a read-only analysis session. Do not edit files or make implementation decisions for the conversational orchestrator. Return findings, evidence, unknowns, and options to the orchestrator.',
    ].join('\n\n');
    const runtime = await this.profiles.resolveRuntime(profile);
    const started = await this.codex.startThread({
      cwd,
      profileInstructions: profile.profile + '\n\n' + skills.map((skill) => skill.content).join('\n\n'),
      developerInstructions,
      mode: 'read-only',
      model: runtime.model,
    });
    const session = await this.sessionCoordinator.createSession(
      {
        taskId: task.id,
        phase: 'analysis',
        profile: profile.role,
        model: runtime.model,
        effectiveModel: runtime.model,
        reasoningEffort: runtime.effort,
        effectiveReasoningEffort: runtime.effort,
        selectedSkills: skillEvidence(skills),
        applicationId: application.id,
        repositoryId: repositoryId || null,
        threadId: started.threadId,
        codexSessionId: started.sessionId,
        status: 'starting',
        attached: true,
        cwd,
        instructionVersion: profile.version,
        projectInstructionVersions: this.instructionVersions(context),
        instructionSources: started.instructionSources,
        startedAt: new Date().toISOString(),
        focus,
      },
      task.projectId || undefined,
    );
    try {
      const turn = await this.codex.startTurn({
        threadId: started.threadId,
        cwd,
        prompt: `Analyze the request and return evidence for the conversational orchestrator.\n\nPersisted taskId: ${task.id}\nProfile: ${profile.role}\nApplication: ${application.data.name || application.name} (${application.id})\nWorking directory: ${cwd}\nFocus: ${focus}\nOriginal user request:\n${task.data.originalRequest}`,
        mode: 'read-only',
        ...runtime,
      });
      const attached = await this.sessionCoordinator.attachTurn(session.id, turn.turnId);
      session.data = attached.data;
      await this.reconcileImmediateTurn(session, started.threadId, turn);
      return { session, status: session.data.status, profile: profile.role, cwd };
    } catch (error) {
      session.data = {
        ...session.data,
        status: 'failed',
        error: this.errorMessage(error),
        completedAt: new Date().toISOString(),
      };
      await this.sessionCoordinator.updateSession(session.id, session.data);
      return { session, status: 'failed', profile: profile.role, cwd, error: session.data.error };
    }
  }

  async startExecution(
    taskId: string,
    projectId: string,
    step: Step,
    subtask: any,
    cwd: string,
    dependencies: Record<string, any>,
  ) {
    const task = await this.records.get(taskId);
    if (task.data.status === 'cancelled') throw new Error('Task was cancelled before this step started');
    const profileId = String(step.profile);
    const profile = await this.profiles.load(profileId);
    const repository = step.repositoryId ? await this.records.get(step.repositoryId) : null;
    const application = step.appId ? await this.records.get(step.appId) : null;
    const skills = selectSkills(profile.skills, step.skills);
    const currentBranch = (await this.codex.runCommand(cwd, ['git', 'branch', '--show-current'])).trim();
    const branch = step.targetBranch;
    const preexistingChanges = await this.codex.runCommand(cwd, [
      'git',
      'status',
      '--porcelain=v1',
      '--untracked-files=normal',
    ]);
    const dockerSocketPath = step.executionCapabilities?.includes('docker')
      ? await this.codex.localDockerSocketPath(cwd)
      : undefined;
    await this.records.update(subtask.id, {
      ...subtask.data,
      status: 'running',
      branch,
      repositoryId: repository?.id,
      applicationId: application?.id,
      path: cwd,
      executionCapabilities: step.executionCapabilities || [],
      preexistingChanges,
      startedAt: new Date().toISOString(),
    });
    const context = await this.records.getProjectContext(projectId);
    const developer = await this.instructions();
    const releaseHandoff = step.releaseOperations
      ? `Explicitly approved release operations (only these targets): ${JSON.stringify(step.releaseOperations)}. All other publication operations remain forbidden. Preserve unrelated work; inspect the exact staged diff before committing. Report blocked operations, never bypass sandbox restrictions.`
      : 'Do not push, commit, open PRs, submit reviews, or merge.';
    const applicationContext = application
      ? `Application: ${application.data.name || application.name} (${application.id})\nPurpose: ${application.data.purpose || ''}\nApplication working directory: ${cwd}`
      : `Application: repository-level assignment\nWorking directory: ${cwd}`;
    const repositoryContext = repository
      ? `Repository: ${repository.data.name || repository.name} (${repository.id})\nRepository root: ${repository.data.path}`
      : `Repository: ${cwd}`;
    const managedContext = [
      `Persisted AgentPier task ID: ${taskId}`,
      `Persisted subtask ID: ${subtask.id}`,
      `Step ID: ${step.id}`,
      `Attempt: ${Number(subtask.data.attempt || 1)}`,
      `Agent profile: ${profile.role || profileId}`,
      applicationContext,
      repositoryContext,
      `User-selected target branch: ${branch}`,
      `Branch at dispatch: ${currentBranch || '(detached or unavailable)'}`,
      `Current working directory: ${cwd}`,
      `Approved execution capabilities: ${(step.executionCapabilities || []).join(', ') || 'none'}`,
    ].join('\n');
    const developerInstructions = [
      developer,
      this.contextText(context),
      `Managed execution context (already persisted and approved):\n${managedContext}`,
      `Implement approved step "${step.title}" on the explicitly user-selected target branch ${branch}. First inspect checkout state and existing changes. If the exact selected branch exists locally or on the configured remote and is not checked out, select that branch before editing. Do not stop merely because it was not checked out at dispatch, and do not select a substitute. If it does not exist anywhere, ask whether to create that exact named branch. Preserve pre-existing uncommitted changes: ${preexistingChanges || '(clean)'}. ${releaseHandoff}`,
      'The orchestrator will not edit project files. Report tool and environment limits as evidence. Choose implementation details and verification order only within this approved scope; preserve read-only and release constraints.',
      'This managed step is already part of a persisted, user-approved plan. Do not call AgentPier MCP tools such as execute_task or get_task_status, and do not ask the user to repeat either ID or plan approval. Work directly in the supplied directory and run the listed checks.',
      dockerSocketPath
        ? `This approved step has local Docker capability through the configured Unix socket ${dockerSocketPath}. Use the repository Compose files and preserve existing volumes; never run destructive volume removal unless the approved step explicitly requires it.`
        : 'No Docker host capability was approved for this step. Do not attempt to access the host Docker socket.',
    ].join('\n\n');
    const runtime = await this.profiles.resolveRuntime(profile);
    const started = await this.codex.startThread({
      cwd,
      profileInstructions: profile.profile + '\n\n' + skills.map((skill) => skill.content).join('\n\n'),
      developerInstructions,
      mode: 'workspace-write',
      model: runtime.model,
    });
    const session = await this.sessionCoordinator.createSession(
      {
        taskId,
        subtaskId: subtask.id,
        phase: 'execution',
        releaseOperations: step.releaseOperations || null,
        profile: profile.role || profileId,
        model: runtime.model,
        effectiveModel: runtime.model,
        reasoningEffort: runtime.effort,
        effectiveReasoningEffort: runtime.effort,
        selectedSkills: skillEvidence(skills),
        applicationId: application?.id || null,
        repositoryId: repository?.id || null,
        threadId: started.threadId,
        codexSessionId: started.sessionId,
        status: 'running',
        attached: true,
        branch,
        instructionVersion: profile.version,
        projectInstructionVersions: this.instructionVersions(context),
        instructionSources: started.instructionSources,
        cwd,
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
    const dependencyText = (step.dependsOn || [])
      .map((key) => {
        const value = JSON.stringify(this.redactContext(dependencies[key] ?? null));
        const truncated = value.length > 3500;
        return `\nOrchestrator-provided context for ${key}${truncated ? ' (truncated)' : ''}:\n${value.slice(0, 3500)}`;
      })
      .join('\n');
    const prompt = `Implement this approved task step directly; the parent task is already approved.\n\nPersisted taskId: ${taskId}\nPersisted subtaskId: ${subtask.id}\nSelected profile: ${profile.role || profileId}\nSelected application: ${application ? `${application.data.name || application.name} (${application.id})` : 'repository-level assignment'}\nAbsolute working directory: ${cwd}\nUser-selected target branch: ${branch}\nObjective: ${step.title}\n\nAllowed scope:\n${step.description}\n\nConstraints:\nOnly implement this approved assignment. Preserve unrelated changes. Do not ask for IDs or approval already included here, and do not recursively call execute_task/get_task_status. Do not commit, push, open PRs, submit reviews, or merge unless explicit capabilities above authorize them.\n\nExpected checks:\n${(step.checks || []).join('\n') || '(No explicit checks)'}\n\nOrchestrator-provided dependency/context records (statuses and outcomes are preserved as supplied):\n${dependencyText || '(No dependencies)'}\n\nFollow local project instructions. Run relevant checks and update docs only as requested by the approved plan. Leave changes in the local working tree for review. Finish with a concise status, changed files, checks, and environment limits.`;
    const turn = await this.codex.startTurn({
      threadId: started.threadId,
      cwd,
      prompt,
      mode: 'workspace-write',
      releaseOperations: step.releaseOperations,
      dockerSocketPath,
      ...runtime,
    });
    const attached = await this.sessionCoordinator.attachTurn(session.id, turn.turnId);
    session.data = attached.data;
    await this.reconcileImmediateTurn(session, started.threadId, turn);
    if (['completed', 'cancelled', 'failed'].includes(session.data.status)) {
      const finished = session.data.status === 'completed';
      const currentSubtask = await this.records.get(subtask.id);
      await this.records.update(subtask.id, {
        ...currentSubtask.data,
        status: finished ? 'awaiting_outcome' : 'blocked',
        outcomeStatus: finished ? 'partial' : 'blocked',
        result: String(session.data.result || ''),
        ...(finished ? { workerCompletedAt: session.data.completedAt } : {}),
        ...(finished
          ? { retryable: false }
          : {
              error: session.data.error || 'Codex worker turn was interrupted before completion',
              retryable: true,
            }),
      });
      return {
        sessionId: session.id,
        threadId: started.threadId,
        turnId: turn.turnId,
        status: finished ? 'awaiting_outcome' : 'blocked',
      };
    }
    if ((await this.records.get(taskId)).data.status === 'cancelled') {
      try {
        await this.codex.interrupt(started.threadId, turn.turnId);
      } catch {
        /* cancellation is already recorded */
      }
      await this.sessionCoordinator.updateSession(session.id, { ...session.data, status: 'cancelled' });
      await this.records.update(subtask.id, { ...subtask.data, status: 'cancelled' });
      return { sessionId: session.id, threadId: started.threadId, turnId: turn.turnId, status: 'cancelled' };
    }
    return { sessionId: session.id, threadId: started.threadId, turnId: turn.turnId, status: 'running' };
  }

  private async instructions() {
    return readFile(join(process.cwd(), 'orchestrator/instructions.md'), 'utf8');
  }

  private async reconcileImmediateTurn(session: any, threadId: string, turn: any) {
    if (!['completed', 'interrupted', 'failed'].includes(turn.status)) return;
    if (['completed', 'cancelled', 'failed'].includes(session.data.status)) return;
    const handled = await this.sessionCoordinator.handleEvent({
      method: turn.status === 'failed' ? 'turn/error' : 'turn/completed',
      params: { threadId, turn: turn.turn || turn },
    });
    if (handled?.session) session.data = handled.session.data;
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

  private errorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown session error';
    return this.redact(message);
  }

  private redactContext(value: any): any {
    if (Array.isArray(value)) return value.map((item) => this.redactContext(item));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .filter(
            ([key]) =>
              !/(password|passwd|secret|token|credential|api[_-]?key|private[_-]?key|authorization)/i.test(key),
          )
          .map(([key, item]) => [key, this.redactContext(item)]),
      );
    return typeof value === 'string' ? this.redact(value) : value;
  }

  private redact(value: string): string {
    return value
      .replace(/\bsk-[A-Za-z0-9_-]{12,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAKIA[A-Z0-9]{16}\b/g, '[REDACTED]')
      .replace(
        /\b(password|passwd|secret|token|api[_-]?key|authorization|private[_-]?key)\s*[:=]\s*\S+/gi,
        '$1=[REDACTED]',
      )
      .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]');
  }
}
