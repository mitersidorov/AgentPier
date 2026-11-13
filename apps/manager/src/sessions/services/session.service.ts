import { Injectable } from '@nestjs/common';
import { ManagerService } from '../../manager/services/manager.service';

@Injectable()
export class SessionService {
  constructor(private readonly records: ManagerService) {}

  async forTask(taskId: string, projectId?: string) {
    return (await this.records.list('session', projectId)).filter((row) => row.data.taskId === taskId);
  }

  async messagesForTask(taskId: string) {
    return (await this.records.list('agent-message')).filter((row) => row.data.taskId === taskId);
  }
}
