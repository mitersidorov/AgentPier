import { Type } from 'class-transformer';
import { IsIn, IsNotEmptyObject, IsOptional, IsUUID, Validate, ValidateIf, ValidateNested } from 'class-validator';
import { ApplicationRecordDataDto } from './application-record-data.dto';
import { ManageApplicationsShapeConstraint } from './validators/manage-applications-shape.validator';
import { HasDefinedPropertiesConstraint } from '../../common/validators/has-defined-properties.validator';

export class ManageApplicationsDto {
  @IsIn(['list', 'register', 'update']) @Validate(ManageApplicationsShapeConstraint) action!: string;
  @IsUUID() projectId!: string;
  @IsOptional() @IsIn(['app', 'repository']) kind?: string;
  @IsOptional() @IsUUID() recordId?: string;
  @ValidateIf((input: ManageApplicationsDto) => input.action !== 'list')
  @IsNotEmptyObject()
  @Validate(HasDefinedPropertiesConstraint)
  @ValidateNested()
  @Type(() => ApplicationRecordDataDto)
  data?: ApplicationRecordDataDto;
}
