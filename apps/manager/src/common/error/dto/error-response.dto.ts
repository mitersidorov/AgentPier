export class ErrorResponseDto {
  statusCode: number;

  path: string;

  message: string;

  errorCode?: string;
}
