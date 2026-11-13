import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class DashboardRecordsQueryDto {
  @IsOptional()
  @IsIn([
    'project',
    'app',
    'repository',
    'task',
    'subtask',
    'session',
    'agent-profile',
    'agent-message',
    'agent-event',
    'instruction',
    'skill',
    'memory',
    'backup',
  ])
  kind?: string;
  @IsOptional() @IsUUID() projectId?: string;
}
