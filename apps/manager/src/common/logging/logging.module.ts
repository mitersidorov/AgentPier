import { Global, Module } from '@nestjs/common';
import { LoggingService } from './services/logging.service';

// Exposes the shared structured logger to Manager modules.
@Global()
@Module({
  providers: [{ provide: LoggingService, useFactory: () => new LoggingService('AgentPier') }],
  exports: [LoggingService],
})
export class LoggingModule {}
