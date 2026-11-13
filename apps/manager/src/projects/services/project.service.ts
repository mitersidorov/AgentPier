import { BadRequestException, Injectable } from '@nestjs/common';
import { ManagerService } from '../../manager/services/manager.service';
import { RegisterProjectDto } from '../dto/register-project.dto';
import { ProjectUpdateDataDto } from '../dto/project-update-data.dto';

@Injectable()
export class ProjectService {
  constructor(private readonly records: ManagerService) {}

  list() {
    return this.records.list('project');
  }

  register(data: RegisterProjectDto) {
    return this.records.create('project', data as unknown as Record<string, any>);
  }

  async update(projectId: string, data: ProjectUpdateDataDto) {
    if ((await this.records.get(projectId)).kind !== 'project')
      throw new BadRequestException('projectId must refer to a project');
    return this.records.update(projectId, data as unknown as Record<string, any>);
  }

  remove(projectId: string) {
    return this.records.deleteProjectCascade(projectId);
  }

  context(projectId: string) {
    return this.records.getProjectContext(projectId);
  }
}
