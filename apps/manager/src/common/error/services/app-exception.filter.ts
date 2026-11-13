import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { LoggingService } from '../../logging/services/logging.service';
import { ErrorResponseDto } from '../dto/error-response.dto';

function statusToCode(status: number): string {
  const map: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'UNPROCESSABLE_ENTITY',
    429: 'RATE_LIMITED',
    500: 'INTERNAL_ERROR',
  };
  return map[status] ?? 'UNKNOWN_ERROR';
}

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggingService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errorCode: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else {
        message = (res as any).message ?? message;
        errorCode = (res as any).errorCode ?? statusToCode(status);
      }
      if (status >= 500) {
        this.logger.error(`${request.method} ${request.path} → ${status}`, exception as Error);
      }
    } else {
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.path}`,
        exception instanceof Error ? exception : new Error('Unknown exception'),
      );
    }

    const payload: ErrorResponseDto = {
      statusCode: status,
      path: request.path,
      message,
      ...(errorCode !== undefined && { errorCode }),
    };
    response.status(status).json(payload);
  }
}
