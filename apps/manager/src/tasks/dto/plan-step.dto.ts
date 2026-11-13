import { ReleaseOperation } from '../types/release-operation.type';
import { ReleaseOperationsConstraint } from './validators/release-operations.validator';
import { ArrayUnique, IsArray, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Validate } from 'class-validator';

export class PlanStepDto {
  @Validate(ReleaseOperationsConstraint) releaseOperations?: ReleaseOperation[];
  @IsOptional() @IsString() @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/) id?: string;
  @IsString() @IsNotEmpty() @MaxLength(255) title!: string;
  @IsString() @IsNotEmpty() @MaxLength(20000) description!: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/) targetBranch?: string;
  @IsOptional() @IsString() @Matches(/^[a-z0-9][a-z0-9-]{0,40}$/) profile?: string;
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  appId?: string;
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  repositoryId?: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) dependsOn?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) checks?: string[];
}
