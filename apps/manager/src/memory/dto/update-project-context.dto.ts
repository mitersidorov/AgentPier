import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsUUID, Validate, ValidateNested } from 'class-validator';
import { ProjectContextDataDto } from './project-context-data.dto';
import { HasDefinedPropertiesConstraint } from '../../common/validators/has-defined-properties.validator';

export class UpdateProjectContextDto {
  @IsUUID() projectId!: string;
  @IsIn(['instruction', 'memory']) kind!: 'instruction' | 'memory';
  @IsOptional() @IsUUID() recordId?: string;
  @Validate(HasDefinedPropertiesConstraint)
  @ValidateNested()
  @Type(() => ProjectContextDataDto)
  data!: ProjectContextDataDto;
  @IsOptional() @IsBoolean() userConfirmed?: boolean;
}
