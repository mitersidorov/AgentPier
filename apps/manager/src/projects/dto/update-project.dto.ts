import { Type } from 'class-transformer';
import { IsUUID, Validate, ValidateNested } from 'class-validator';
import { ProjectUpdateDataDto } from './project-update-data.dto';
import { HasDefinedPropertiesConstraint } from '../../common/validators/has-defined-properties.validator';

export class UpdateProjectDto {
  @IsUUID() projectId!: string;
  @Validate(HasDefinedPropertiesConstraint)
  @ValidateNested()
  @Type(() => ProjectUpdateDataDto)
  data!: ProjectUpdateDataDto;
}
