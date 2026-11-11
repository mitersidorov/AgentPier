import { BadRequestException, Injectable } from '@nestjs/common';
import { ManagerService } from '../manager/manager.service';

@Injectable()
export class MemoryService {
  constructor(private readonly records: ManagerService) {}

  async update(input: {
    projectId: string;
    kind: 'instruction' | 'memory';
    recordId?: string;
    data: Record<string, any>;
    userConfirmed?: boolean;
  }) {
    if ((await this.records.get(input.projectId)).kind !== 'project')
      throw new BadRequestException('projectId must refer to a project');
    const data = { ...input.data };
    if (input.kind === 'memory' && data.status === 'confirmed') {
      if (input.userConfirmed !== true)
        throw new BadRequestException('Only an explicit user decision can mark project memory as confirmed');
      data.source = 'user_confirmed';
      data.confirmedAt = new Date().toISOString();
    } else if (input.kind === 'memory' && !data.source) {
      data.source = 'draft';
      data.status ||= 'draft';
    }
    if (input.recordId) {
      const row = await this.records.get(input.recordId);
      if (row.projectId !== input.projectId || row.kind !== input.kind)
        throw new BadRequestException('recordId must match the requested context kind and project');
      return this.records.update(input.recordId, data);
    }
    return this.records.create(input.kind, data, input.projectId);
  }
}
