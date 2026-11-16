import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class DispatchAnalysisDto {
  @IsUUID() taskId!: string;
  @IsUUID() appId!: string;
  @IsOptional() @IsUUID() repositoryId?: string;
  @IsString() @IsNotEmpty() @MaxLength(41) @Matches(/^[a-z0-9][a-z0-9-]{0,40}$/) profile!: string;
  @IsIn(['application', 'repository']) workingDirectory!: 'application' | 'repository';
  @IsString() @IsNotEmpty() @MaxLength(20000) focus!: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) skills?: string[];
}
