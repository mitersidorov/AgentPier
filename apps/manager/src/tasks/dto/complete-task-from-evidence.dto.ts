import { ArrayMinSize, Equals, IsArray, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class CompleteTaskFromEvidenceDto {
  @IsUUID() taskId!: string;
  @IsUUID() subtaskId!: string;
  @IsString() @IsNotEmpty() @MaxLength(20000) result!: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) evidence!: string[];
  @Equals(true) userConfirmed!: boolean;
}
