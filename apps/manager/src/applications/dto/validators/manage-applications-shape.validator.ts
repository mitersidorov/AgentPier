import { ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

@ValidatorConstraint({ name: 'manageApplicationsShape', async: false })
export class ManageApplicationsShapeConstraint implements ValidatorConstraintInterface {
  validate(action: unknown, args: ValidationArguments) {
    const input = args.object as Record<string, unknown>;
    const has = (key: string) => input[key] !== undefined;
    if (action === 'list') return !has('kind') && !has('recordId') && !has('data');
    if (action === 'register')
      return ['app', 'repository'].includes(String(input.kind)) && has('data') && !has('recordId');
    if (action === 'update') return has('recordId') && has('data');
    return false;
  }

  defaultMessage(args: ValidationArguments) {
    switch (args.value) {
      case 'list':
        return 'list accepts only action and projectId';
      case 'register':
        return 'register requires kind and data and does not accept recordId';
      case 'update':
        return 'update requires recordId and data';
      default:
        return 'Unsupported application management action';
    }
  }
}
