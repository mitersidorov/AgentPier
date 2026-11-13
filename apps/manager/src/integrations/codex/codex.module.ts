import { Module } from '@nestjs/common';
import { HttpModule } from '../../common/http/http.module';
import { LoggingModule } from '../../common/logging/logging.module';
import { CodexAppServerService } from './services/codex-app-server.service';

// Provides the host Codex app-server connection and health checks.
@Module({
  imports: [HttpModule, LoggingModule],
  providers: [CodexAppServerService],
  exports: [CodexAppServerService],
})
export class CodexModule {}
