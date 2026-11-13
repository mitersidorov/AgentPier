import { IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ProjectContextDataDto {
  @IsOptional() @IsString() @MaxLength(255) name?: string;
  @IsOptional() @IsString() @MaxLength(255) title?: string;
  @IsOptional() @IsIn(['architecture', 'stack', 'application']) category?: 'architecture' | 'stack' | 'application';
  @IsOptional() @IsString() @MaxLength(50000) content?: string;
  @IsOptional() @IsString() @MaxLength(50000) instructions?: string;
  @IsOptional() @IsString() @MaxLength(20000) description?: string;
  @IsOptional() @IsString() @MaxLength(20000) rationale?: string;
  @IsOptional() @IsString() @MaxLength(20000) source?: string;
  @IsOptional() @IsIn(['draft', 'confirmed']) status?: 'draft' | 'confirmed';
  @IsOptional() @IsArray() @IsString({ each: true }) constraints?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) decisions?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) acceptanceCriteria?: string[];
}
