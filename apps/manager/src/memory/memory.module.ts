import { Module } from '@nestjs/common';
import { ManagerModule } from '../manager/manager.module';
import { MemoryService } from './services/memory.service';

// Manages confirmed project context and memory.
@Module({ imports: [ManagerModule], providers: [MemoryService], exports: [MemoryService] })
export class MemoryModule {}
