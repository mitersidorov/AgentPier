import { IsBoolean, IsOptional } from 'class-validator';

export class CreateBackupDto {
  @IsOptional() @IsBoolean() verifyRestore?: boolean;
}
