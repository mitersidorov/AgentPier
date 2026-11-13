import { Type } from 'class-transformer';
import { Equals, IsObject, IsUUID, ValidateNested } from 'class-validator';
import { TaskPlanDto } from './task-plan.dto';

export class ApprovePlanDto {
  @IsUUID() taskId!: string;
  @IsObject() @ValidateNested() @Type(() => TaskPlanDto) plan!: TaskPlanDto;
  @Equals(true) userConfirmed!: true;
}
