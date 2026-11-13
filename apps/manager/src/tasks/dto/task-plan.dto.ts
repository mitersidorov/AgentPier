import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { PlanStepDto } from './plan-step.dto';

export class TaskPlanDto {
  @IsOptional() @IsString() @MaxLength(20000) summary?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PlanStepDto) steps!: PlanStepDto[];
  @IsOptional() @IsArray() @IsString({ each: true }) decisions?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) constraints?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) acceptanceCriteria?: string[];
}
