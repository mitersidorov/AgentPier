import {
  IsNotEmpty,
  IsNotEmptyObject,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Validate,
} from 'class-validator';
import { AgentAnswersMapConstraint } from './validators/agent-answers-map.validator';
import { AgentMessageModeConstraint } from './validators/agent-message-mode.validator';

export class SendAgentMessageDto {
  @IsUUID() @Validate(AgentMessageModeConstraint) taskId!: string;
  @IsUUID() sessionId!: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(20000) message?: string;
  @IsOptional() @IsUUID() questionMessageId?: string;
  @IsOptional() @IsObject() @IsNotEmptyObject() @Validate(AgentAnswersMapConstraint) answers?: Record<string, string[]>;
}
