import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class RecordOrchestrationDecisionDto {
  @IsUUID()
  taskId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  decision!: string;
}
