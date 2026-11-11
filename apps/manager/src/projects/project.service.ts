import { BadRequestException, Injectable } from '@nestjs/common';
import { ManagerService } from '../manager/manager.service';

@Injectable()
export class ProjectService {
  constructor(private readonly records: ManagerService) {}

  list() {
    return this.records.list('project');
  }

  register(data: Record<string, any>) {
    return this.records.create('project', data);
  }

  async update(projectId: string, data: Record<string, any>) {
    if ((await this.records.get(projectId)).kind !== 'project')
      throw new BadRequestException('projectId must refer to a project');
    return this.records.update(projectId, data);
  }

  context(projectId: string) {
    return this.records.getProjectContext(projectId);
  }
}
