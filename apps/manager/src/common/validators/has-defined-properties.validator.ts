import { ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

@ValidatorConstraint({ name: 'hasDefinedProperties', async: false })
export class HasDefinedPropertiesConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.values(value).some((entry) => entry !== undefined && entry !== null);
  }

  defaultMessage() {
    return 'object must contain at least one defined property';
  }
}
