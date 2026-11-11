import { BadRequestException, Injectable } from '@nestjs/common';
import { ManagerService } from '../manager/manager.service';

@Injectable()
export class ApplicationService {
  constructor(private readonly records: ManagerService) {}

  async manage(input: {
    action: string;
    projectId: string;
    kind?: string;
    recordId?: string;
    data?: Record<string, any>;
  }) {
    if ((await this.records.get(input.projectId)).kind !== 'project')
      throw new BadRequestException('projectId must refer to a project');
    if (input.action === 'list') {
      const [applications, repositories] = await Promise.all([
        this.records.list('app', input.projectId),
        this.records.list('repository', input.projectId),
      ]);
      return { applications, repositories };
    }
    if (input.action === 'register') {
      if (!['app', 'repository'].includes(input.kind || ''))
        throw new BadRequestException('kind must be app or repository');
      return this.records.create(input.kind!, input.data || {}, input.projectId);
    }
    if (input.action === 'update' && input.recordId) {
      const row = await this.records.get(input.recordId);
      if (!['app', 'repository'].includes(row.kind) || row.projectId !== input.projectId)
        throw new BadRequestException('recordId must refer to an application or repository in projectId');
      return this.records.update(input.recordId, input.data || {});
    }
    throw new BadRequestException('Use action=list, register, or update with a project-owned record');
  }
}
