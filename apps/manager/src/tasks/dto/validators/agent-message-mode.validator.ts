import { ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

@ValidatorConstraint({ name: 'agentMessageMode', async: false })
export class AgentMessageModeConstraint implements ValidatorConstraintInterface {
  validate(taskId: unknown, args: ValidationArguments) {
    if (typeof taskId !== 'string') return false;
    const value = args.object as { message?: unknown; questionMessageId?: unknown; answers?: unknown };
    const hasMessage = typeof value.message === 'string' && value.message.trim().length > 0;
    const hasQuestionAnswer =
      typeof value.questionMessageId === 'string' && value.answers !== undefined && value.answers !== null;
    return hasMessage !== hasQuestionAnswer;
  }

  defaultMessage() {
    return 'Provide either a message or a questionMessageId with answers';
  }
}
