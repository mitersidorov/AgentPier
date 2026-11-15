import { BadRequestException, Injectable } from '@nestjs/common';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { Step } from '../types/orchestration-step.type';
import { validReleaseOperations } from '../../tasks/types/release-operation.type';

/** Runs ready approved-plan steps while protecting task and working-tree boundaries. */
@Injectable()
export class ApprovedPlanExecutionService {
  private readonly activeWritePaths = new Set<string>();

  normalizeSteps(value: unknown, availableProfiles: Set<string>): Step[] {
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

  validateGraph(steps: Step[]) {
    const ids = new Set(steps.map((step) => step.id));
    if (ids.size !== steps.length) throw new BadRequestException('Plan step IDs must be unique');
    for (const step of steps)
      for (const dep of step.dependsOn || [])
        if (!ids.has(dep) || dep === step.id) throw new BadRequestException(`Invalid dependency ${dep} in ${step.id}`);
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

  private canonicalProfile(role: string) {
    return role === 'backend' ? 'backend-nestjs' : role === 'frontend' ? 'frontend-angular' : role;
  }

  async executeGraph(
    taskId: string,
    steps: Step[],
    records: any[],
    port: {
      requireTask(id: string): Promise<any>;
      stepRepoPath(projectId: string, step: Step): Promise<string>;
      assertNoActivePathSessions(projectId: string, path: string, taskId: string, subtaskId?: string): Promise<void>;
      isReusableSuccess(subtask: any): boolean;
      executeStep(
        taskId: string,
        projectId: string,
        step: Step,
        subtask: any,
        path: string,
        dependencies: Record<string, string>,
      ): Promise<string>;
      updateTask(id: string, data: Record<string, unknown>): Promise<unknown>;
      createBackup(kind: string): Promise<unknown>;
    },
  ) {
    const projectId = (await port.requireTask(taskId)).projectId!;
    const completedRecords = new Map(
      records.filter((item) => port.isReusableSuccess(item)).map((item) => [item.data.id, item]),
    );
    const pending = new Map(steps.filter((step) => !completedRecords.has(step.id)).map((step) => [step.id, step]));
    const completed = new Map([...completedRecords].map(([id, item]) => [id, String(item.data.result || '')]));
    const running = new Map<string, Promise<void>>();
    let waitingForActivePath = false;
    while (pending.size || running.size) {
      if ((await port.requireTask(taskId)).data.status === 'cancelled') return;
      waitingForActivePath = false;
      const ready = [...pending.values()].filter((step) => (step.dependsOn || []).every((id) => completed.has(id)));
      for (const step of ready) {
        if (running.size >= 3) break;
        const subtask = records.find((item) => item.data.id === step.id || item.data.title === step.title);
        const path = await port.stepRepoPath(projectId, step);
        if ([...this.activeWritePaths].some((activePath) => this.pathsOverlap(activePath, path))) {
          waitingForActivePath = true;
          continue;
        }
        await port.assertNoActivePathSessions(projectId, path, taskId, subtask?.id);
        pending.delete(step.id);
        this.activeWritePaths.add(path);
        const promise = port
          .executeStep(
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
    if ((await port.requireTask(taskId)).data.status === 'cancelled') return;
    await port.updateTask(taskId, { status: 'review_ready', completedAt: new Date().toISOString() });
    await port.createBackup('milestone');
  }

  pathsOverlap(left: string, right: string) {
    const a = resolve(left);
    const b = resolve(right);
    const aToB = relative(a, b);
    const bToA = relative(b, a);
    const inside = (path: string) =>
      path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
    return inside(aToB) || inside(bToA);
  }
}
