import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class AnalyzeTaskDto {
  @IsUUID() projectId!: string;
  @IsString() @IsNotEmpty() @MaxLength(20000) request!: string;
}
