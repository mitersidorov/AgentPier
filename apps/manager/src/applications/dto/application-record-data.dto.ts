import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ApplicationRecordDataDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) name?: string;
  @IsOptional() @IsString() @MaxLength(20000) purpose?: string;
  @IsOptional() @IsString() @MaxLength(20000) description?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(4096) path?: string;
  @IsOptional() @IsUUID() repositoryId?: string;
  @IsOptional() @IsString() @MaxLength(2048) remoteUrl?: string;
}
