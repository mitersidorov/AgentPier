import { ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { validReleaseOperations } from '../../types/release-operation.type';

@ValidatorConstraint({ name: 'releaseOperations', async: false })
export class ReleaseOperationsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return value === undefined || validReleaseOperations(value);
  }
  defaultMessage() {
    return 'releaseOperations must contain explicit typed operation targets';
  }
}
