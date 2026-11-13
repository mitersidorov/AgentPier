import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ManagerService } from '../../manager/services/manager.service';
import { UpdateProjectContextDto } from '../dto/update-project-context.dto';

@Injectable()
export class MemoryService {
  constructor(private readonly records: ManagerService) {}

  async update(input: UpdateProjectContextDto) {
    if ((await this.records.get(input.projectId)).kind !== 'project')
      throw new BadRequestException('projectId must refer to a project');
    const data = { ...input.data } as Record<string, any>;
    if (input.kind === 'instruction') {
      const existing = input.recordId ? await this.records.get(input.recordId) : undefined;
      const effective = { ...existing?.data, ...data };
      const content = String(effective.content || effective.instructions || '');
      const previousContent = String(existing?.data.content || existing?.data.instructions || '');
      const confirmed = input.userConfirmed === true;
      if (effective.status === 'confirmed' && !confirmed)
        throw new BadRequestException('Only an explicit user decision can confirm a project instruction');
      const contentChanged = !existing || content !== previousContent;
      data.status = confirmed
        ? 'confirmed'
        : existing?.data.status === 'confirmed' && !contentChanged
          ? 'confirmed'
          : 'draft';
      data.source = confirmed ? 'user_confirmed' : data.status === 'confirmed' ? existing?.data.source : 'draft';
      if (confirmed) data.confirmedAt = existing?.data.confirmedAt || new Date().toISOString();
      else if (existing?.data.confirmedAt) data.confirmedAt = existing.data.confirmedAt;
      else delete data.confirmedAt;
      data.version = (existing?.data.version || 0) + (contentChanged ? 1 : 0);
      data.contentHash = createHash('sha256').update(content).digest('hex');
    } else if (input.kind === 'memory' && data.status === 'confirmed') {
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
