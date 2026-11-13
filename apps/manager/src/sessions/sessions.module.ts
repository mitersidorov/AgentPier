import { Module } from '@nestjs/common';
import { ManagerModule } from '../manager/manager.module';
import { SessionService } from './services/session.service';

// Stores and retrieves Codex session history.
@Module({ imports: [ManagerModule], providers: [SessionService], exports: [SessionService] })
export class SessionsModule {}
