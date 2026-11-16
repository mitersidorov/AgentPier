import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class BeginExecutionDto {
  @IsUUID() taskId!: string;
  @IsString() @IsNotEmpty() @MaxLength(20000) decision!: string;
}
