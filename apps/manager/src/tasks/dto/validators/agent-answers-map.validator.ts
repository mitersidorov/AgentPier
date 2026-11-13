import { ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

@ValidatorConstraint({ name: 'agentAnswersMap', async: false })
export class AgentAnswersMapConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.entries(value).every(
        ([key, answers]) =>
          Boolean(key.trim()) &&
          Array.isArray(answers) &&
          answers.length > 0 &&
          answers.every((answer) => typeof answer === 'string' && answer.trim().length > 0 && answer.length <= 20000),
      )
    );
  }

  defaultMessage() {
    return 'answers must map question IDs to non-empty arrays of text';
  }
}
