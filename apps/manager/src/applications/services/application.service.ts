import { BadRequestException, Injectable } from '@nestjs/common';
import { ManagerService } from '../../manager/services/manager.service';
import { ManageApplicationsDto } from '../dto/manage-applications.dto';

@Injectable()
export class ApplicationService {
  constructor(private readonly records: ManagerService) {}

  async manage(input: ManageApplicationsDto) {
    if ((await this.records.get(input.projectId)).kind !== 'project')
      throw new BadRequestException('projectId must refer to a project');
    if (input.action === 'list') {
      if (['kind', 'recordId', 'data'].some((key) => input[key] !== undefined))
        throw new BadRequestException('List actions only accept projectId and action');
      const [applications, repositories] = await Promise.all([
        this.records.list('app', input.projectId),
        this.records.list('repository', input.projectId),
      ]);
      return { applications, repositories };
    }
    if (input.action === 'register') {
      if (!['app', 'repository'].includes(input.kind || ''))
        throw new BadRequestException('kind must be app or repository');
      if (input.recordId || !input.data || typeof input.data.name !== 'string' || !input.data.name.trim())
        throw new BadRequestException('Register actions require data.name and do not accept recordId');
      if (typeof input.data.path !== 'string' || !input.data.path.trim())
        throw new BadRequestException('Register actions require an absolute data.path');
      if (input.kind === 'app' && input.data.remoteUrl !== undefined)
        throw new BadRequestException('remoteUrl belongs to a repository record, not an application');
      if (input.kind === 'repository' && (input.data.purpose !== undefined || input.data.repositoryId !== undefined))
        throw new BadRequestException('purpose and repositoryId belong to application records');
      await this.validateRepositoryLink(input.data.repositoryId, input.projectId);
      return this.records.create(input.kind!, input.data as unknown as Record<string, any>, input.projectId);
    }
    if (input.action === 'update' && input.recordId && input.data) {
      const row = await this.records.get(input.recordId);
      if (!['app', 'repository'].includes(row.kind) || row.projectId !== input.projectId)
        throw new BadRequestException('recordId must refer to an application or repository in projectId');
      if (input.kind && input.kind !== row.kind)
        throw new BadRequestException('kind must match the selected project record');
      if (Object.keys(input.data).length === 0)
        throw new BadRequestException('Update actions require at least one data field');
      if (row.kind === 'app' && input.data.remoteUrl !== undefined)
        throw new BadRequestException('remoteUrl belongs to a repository record, not an application');
      if (row.kind === 'repository' && (input.data.purpose !== undefined || input.data.repositoryId !== undefined))
        throw new BadRequestException('purpose and repositoryId belong to application records');
      await this.validateRepositoryLink(input.data.repositoryId, input.projectId);
      return this.records.update(input.recordId, input.data as unknown as Record<string, any>);
    }
    throw new BadRequestException('Use action=list, register, or update with a project-owned record');
  }

  private async validateRepositoryLink(repositoryId: unknown, projectId: string) {
    if (!repositoryId) return;
    const repository = await this.records.get(String(repositoryId));
    if (repository.kind !== 'repository' || repository.projectId !== projectId)
      throw new BadRequestException('repositoryId must refer to a repository in the same project');
  }
}
