import { ArrayMinSize, IsArray, IsIn, IsObject, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class DispatchAssignmentDto {
  @IsUUID()
  taskId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  stepId!: string;

  @IsObject()
  dependencies!: Record<string, any>;
}

export class RecordAssignmentOutcomeDto {
  @IsUUID()
  taskId!: string;

  @IsUUID()
  subtaskId!: string;

  @IsIn(['completed', 'partial', 'blocked'])
  status!: 'completed' | 'partial' | 'blocked';

  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  outcome!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  evidence!: string[];
}
