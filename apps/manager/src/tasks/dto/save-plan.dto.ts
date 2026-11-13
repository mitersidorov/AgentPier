import { Type } from 'class-transformer';
import { IsObject, IsUUID, ValidateNested } from 'class-validator';
import { TaskPlanDto } from './task-plan.dto';

export class SavePlanDto {
  @IsUUID() taskId!: string;
  @IsObject() @ValidateNested() @Type(() => TaskPlanDto) plan!: TaskPlanDto;
}
