import { IsUUID } from 'class-validator';

export class DeleteProjectDto {
  @IsUUID() projectId!: string;
}
