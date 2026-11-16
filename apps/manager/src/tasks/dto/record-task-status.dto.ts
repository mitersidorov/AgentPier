import { IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class RecordTaskStatusDto {
  @IsUUID()
  taskId!: string;

  @IsIn([
    'pending_action',
    'analysis_running',
    'analysis_complete',
    'plan_draft',
    'approved',
    'executing',
    'review_ready',
    'completed',
    'blocked',
    'cancelled',
  ])
  status!:
    | 'pending_action'
    | 'analysis_running'
    | 'analysis_complete'
    | 'plan_draft'
    | 'approved'
    | 'executing'
    | 'review_ready'
    | 'completed'
    | 'blocked'
    | 'cancelled';

  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  decision!: string;
}
