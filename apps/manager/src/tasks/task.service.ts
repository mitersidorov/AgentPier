import { Injectable } from '@nestjs/common';
import { ManagerService } from '../manager/manager.service';
import { TaskOrchestratorService } from '../orchestration/task-orchestrator.service';

@Injectable()
export class TaskService {
  constructor(
    private readonly records: ManagerService,
    private readonly orchestration: TaskOrchestratorService,
  ) {}

  analyze(projectId: string, request: string) {
    return this.orchestration.analyze(projectId, request);
  }
  analysis(taskId: string) {
    return this.orchestration.getAnalysisResults(taskId);
  }
  draft(taskId: string, plan: Record<string, any>) {
    return this.records.saveDraftPlan(taskId, plan);
  }
  approve(taskId: string, plan: Record<string, any>, userConfirmed: boolean) {
    return this.records.approvePlan(taskId, {
      ...plan,
      explicitlyConfirmed: userConfirmed,
      confirmationSource: 'user',
    });
  }
  execute(taskId: string) {
    return this.orchestration.execute(taskId);
  }
  status(taskId: string) {
    return this.orchestration.status(taskId);
  }
  messages(taskId: string) {
    return this.orchestration.messages(taskId);
  }
  sendMessage(input: Parameters<TaskOrchestratorService['sendMessage']>[0]) {
    return this.orchestration.sendMessage(input);
  }
  cancel(taskId: string) {
    return this.orchestration.cancel(taskId);
  }
  results(taskId: string) {
    return this.orchestration.results(taskId);
  }
}
