import { Module } from '@nestjs/common';
import { HttpService } from './services/http.service';
import { LoggingModule } from '../logging/logging.module';

// Provides a reusable outbound HTTP client with retry and timeout handling.
@Module({
  imports: [LoggingModule],
  providers: [HttpService],
  exports: [HttpService],
})
export class HttpModule {}
