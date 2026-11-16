import { Injectable } from '@nestjs/common';
import { ManagerService } from '../../manager/services/manager.service';
import { TaskOrchestratorService } from '../../orchestration/services/task-orchestrator.service';
import { TaskPlanDto } from '../dto/task-plan.dto';
import { DispatchAnalysisDto } from '../dto/dispatch-analysis.dto';

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
  draft(taskId: string, plan: TaskPlanDto) {
    return this.records.saveDraftPlan(taskId, plan as unknown as Record<string, any>);
  }
  approve(taskId: string, plan: TaskPlanDto, userConfirmed: boolean) {
    return this.records.approvePlan(taskId, {
      ...(plan as unknown as Record<string, any>),
      explicitlyConfirmed: userConfirmed,
      confirmationSource: 'user',
    });
  }
  execute(taskId: string, decision: string) {
    return this.orchestration.execute(taskId, decision);
  }
  dispatchAnalysis(input: DispatchAnalysisDto) {
    return this.orchestration.dispatchAnalysis(input);
  }
  completeFromEvidence(taskId: string, subtaskId: string, result: string, evidence: string[], userConfirmed: boolean) {
    return this.orchestration.completeFromEvidence(taskId, subtaskId, result, evidence, userConfirmed);
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

  read(taskId: string) {
    return this.orchestration.readTask(taskId);
  }

  recordDecision(taskId: string, decision: string) {
    return this.orchestration.recordDecision(taskId, decision);
  }

  dispatchAssignment(taskId: string, stepId: string, dependencies: Record<string, any>) {
    return this.orchestration.dispatchAssignment(taskId, stepId, dependencies);
  }

  recordAssignmentOutcome(
    taskId: string,
    subtaskId: string,
    status: 'completed' | 'partial' | 'blocked',
    outcome: string,
    evidence: string[],
  ) {
    return this.orchestration.recordAssignmentOutcome(taskId, subtaskId, status, outcome, evidence);
  }

  recordTaskStatus(
    taskId: string,
    status: Parameters<TaskOrchestratorService['recordTaskStatus']>[1],
    decision: string,
  ) {
    return this.orchestration.recordTaskStatus(taskId, status, decision);
  }
}
