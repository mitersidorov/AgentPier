import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ManagerRecord } from './entities/manager-record.entity';
import { ManagerController } from './manager.controller';
import { ManagerService } from './manager.service';
import { AppServerService } from './services/app-server.service';

@Module({
  imports: [TypeOrmModule.forFeature([ManagerRecord])],
  controllers: [ManagerController],
  providers: [ManagerService, AppServerService],
})
export class ManagerModule implements OnModuleInit {
  constructor(private readonly manager: ManagerService) {}
  async onModuleInit() {
    await this.manager.seedProfiles();
  }
}
