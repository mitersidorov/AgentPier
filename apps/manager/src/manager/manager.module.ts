import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ManagerRecord } from './entities/manager-record.entity';
import { ManagerService } from './services/manager.service';
import { CodexModule } from '../integrations/codex/codex.module';

// Provides persistent Manager records and shared record operations.
@Module({
  imports: [TypeOrmModule.forFeature([ManagerRecord]), CodexModule],
  providers: [ManagerService],
  exports: [ManagerService],
})
export class ManagerModule {}
