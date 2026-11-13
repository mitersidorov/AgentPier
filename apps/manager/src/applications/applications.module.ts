import { Module } from '@nestjs/common';
import { ManagerModule } from '../manager/manager.module';
import { ApplicationService } from './services/application.service';

// Manages project applications and linked repositories.
@Module({ imports: [ManagerModule], providers: [ApplicationService], exports: [ApplicationService] })
export class ApplicationsModule {}
