import { Controller, Get } from '@nestjs/common';
import { HealthService } from '../services/health.service';
import { HealthResponseDto } from '../dto/health-response.dto';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth(): HealthResponseDto {
    return this.healthService.getHealth();
  }
}
