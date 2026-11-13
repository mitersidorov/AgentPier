import { Module } from '@nestjs/common';
import { ManagerModule } from '../manager/manager.module';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { TaskService } from './services/task.service';

// Manages task lifecycle and delegates execution to orchestration.
@Module({ imports: [ManagerModule, OrchestrationModule], providers: [TaskService], exports: [TaskService] })
export class TasksModule {}
