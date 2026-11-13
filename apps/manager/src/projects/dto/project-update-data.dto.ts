import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ProjectUpdateDataDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) name?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(4096) path?: string;
  @IsOptional() @IsString() @MaxLength(20000) description?: string;
  @IsOptional() @IsString() @MaxLength(20000) instructions?: string;
  @IsOptional() @IsString() @MaxLength(20000) constraints?: string;
}
