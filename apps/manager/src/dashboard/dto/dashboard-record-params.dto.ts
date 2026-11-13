import { IsUUID } from 'class-validator';

export class DashboardRecordParamsDto {
  @IsUUID() id!: string;
}
