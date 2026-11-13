import { IsOptional, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateAgentProfileDto {
  @IsString() @Matches(/^(backend-nestjs|frontend-angular)$/) role!: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) model?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(40) defaultReasoningEffort?: string;
}
