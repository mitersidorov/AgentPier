import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import { Repository } from 'typeorm';
import { ManagerRecord } from './entities/manager-record.entity';

@Injectable()
export class ManagerService {
  constructor(@InjectRepository(ManagerRecord) private readonly records: Repository<ManagerRecord>) {}

  list(kind?: string, projectId?: string) {
    return this.records.find({
      where: { ...(kind ? { kind } : {}), ...(projectId ? { projectId } : {}) },
      order: { createdAt: 'DESC' },
    });
  }

  async databaseStatus() {
    try {
      await this.records.count();
      return { connected: true as const };
    } catch (error) {
      return { connected: false as const, reason: error instanceof Error ? error.message : 'MySQL query failed' };
    }
  }

  async get(id: string) {
    const row = await this.records.findOneBy({ id });
    if (!row) throw new NotFoundException(`Record ${id} not found`);
    return row;
  }

  async create(kind: string, body: Record<string, any>, projectId?: string) {
    this.validateKind(kind);
    const data = { ...body };
    this.assertNoSecrets(data);
    const name = typeof data.name === 'string' ? data.name : null;
    if (kind === 'app' || kind === 'repository') await this.validateLocalPath(data.path, projectId);
    if (kind === 'project' && data.path) await this.validateLocalPath(data.path);
    if (kind === 'repository' && data.remoteUrl) this.validateRemoteUrl(data.remoteUrl);
    const row = this.records.create({ id: randomUUID(), kind, projectId: projectId || null, name, data });
    return this.records.save(row);
  }

  async update(id: string, body: Record<string, any>) {
    const row = await this.get(id);
    if (row.kind === 'agent-profile') throw new BadRequestException('Built-in agent profiles cannot be edited');
    const data = { ...row.data, ...body };
    this.assertNoSecrets(data);
    if (['app', 'repository', 'project'].includes(row.kind) && data.path)
      await this.validateLocalPath(data.path, row.projectId || undefined);
    if (row.kind === 'repository' && data.remoteUrl) this.validateRemoteUrl(data.remoteUrl);
    row.data = data;
    row.name = typeof data.name === 'string' ? data.name : row.name;
    return this.records.save(row);
  }

  async saveAnalysis(projectId: string, request: string) {
    if (!request?.trim()) throw new BadRequestException('The original user request is required');
    const project = await this.get(projectId);
    if (project.kind !== 'project') throw new BadRequestException('projectId must refer to a project');
    const agents = await this.list('agent-profile');
    return this.create(
      'task',
      {
        name: request.slice(0, 240),
        originalRequest: request,
        status: 'analysis_pending',
        approvedPlan: null,
        results: [],
        sessions: [],
        profiles: agents.map((a) => a.name),
        createdAt: new Date().toISOString(),
      },
      projectId,
    );
  }

  async approvePlan(taskId: string, plan: Record<string, any>) {
    const task = await this.get(taskId);
    if (task.kind !== 'task') throw new BadRequestException('taskId must refer to a task');
    if (plan.explicitlyConfirmed !== true)
      throw new BadRequestException(
        'The plan can only be approved after explicit user confirmation (explicitlyConfirmed: true)',
      );
    task.data = { ...task.data, approvedPlan: plan, status: 'approved', approvedAt: new Date().toISOString() };
    return this.records.save(task);
  }

  async seedProfiles() {
    for (const [name, role] of [
      ['Backend developer', 'backend'],
      ['Frontend developer', 'frontend'],
    ]) {
      if (!(await this.records.exist({ where: { kind: 'agent-profile', name } }))) {
        await this.records.save(
          this.records.create({
            id: randomUUID(),
            kind: 'agent-profile',
            projectId: null,
            name,
            data: { name, role, instructions: `Universal ${role} profile. Follow global and project instructions.` },
          }),
        );
      }
    }
  }

  private validateKind(kind: string) {
    const allowed = ['project', 'app', 'repository', 'task', 'instruction', 'skill', 'memory', 'backup'];
    if (!allowed.includes(kind)) throw new BadRequestException(`Unsupported record kind: ${kind}`);
  }

  private validateRemoteUrl(value: unknown) {
    if (
      typeof value !== 'string' ||
      value.length > 2048 ||
      !/^(https?:\/\/|ssh:\/\/|git@[\w.-]+:)[^\s]+$/.test(value)
    ) {
      throw new BadRequestException('remoteUrl must be an HTTPS, SSH or git@ remote URL');
    }
  }

  private assertNoSecrets(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (/(password|secret|token|api[_-]?key|credential|private[_-]?key)/i.test(key))
        throw new BadRequestException(`Sensitive field "${key}" cannot be stored in Manager records`);
      if (
        typeof child === 'string' &&
        /(\bsk-[A-Za-z0-9_-]{12,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAKIA[A-Z0-9]{16}\b)/.test(child)
      )
        throw new BadRequestException('A value resembling a credential cannot be stored in Manager records');
      if (child && typeof child === 'object') this.assertNoSecrets(child);
    }
  }

  private async validateLocalPath(path: unknown, projectId?: string) {
    if (typeof path !== 'string' || !isAbsolute(path))
      throw new BadRequestException('Local path must be an absolute path');
    if (projectId) {
      const project = await this.get(projectId);
      const root = project.data.path;
      if (typeof root !== 'string' || !isAbsolute(root))
        throw new BadRequestException('Register an absolute project path before adding applications');
      const rel = relative(resolve(root), resolve(path));
      if (rel.startsWith('..') || isAbsolute(rel))
        throw new BadRequestException('Application path must stay inside the registered project directory');
    }
  }
}
