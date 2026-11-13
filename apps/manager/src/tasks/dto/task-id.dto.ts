import { IsUUID } from 'class-validator';

export class TaskIdDto {
  @IsUUID() taskId!: string;
}
