import { Allow } from 'class-validator';

export class EmptyToolArgumentsDto {
  @Allow() private readonly validationMarker?: never;
}
