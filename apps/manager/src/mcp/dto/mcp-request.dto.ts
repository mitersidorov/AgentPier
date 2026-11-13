import { Allow, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class McpRequestDto {
  @IsIn(['2.0']) jsonrpc!: string;
  @Allow() id?: string | number | null;
  @IsString() @IsNotEmpty() @MaxLength(200) method!: string;
  @IsOptional() @IsObject() @Allow() params?: Record<string, unknown>;
}
