import { IsUUID } from 'class-validator';

export class ProjectContextQueryDto {
  @IsUUID() projectId!: string;
}
