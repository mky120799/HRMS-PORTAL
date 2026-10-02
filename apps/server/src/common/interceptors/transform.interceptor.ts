import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata, StreamableFile } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export const RAW_RESPONSE_KEY = 'rawResponse';
/** Skip the success envelope for protocol endpoints whose clients expect an exact shape (SCIM). */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);

/**
 * Success envelope: { success: true, data, timestamp }. File downloads
 * (StreamableFile) and @RawResponse() routes pass through untouched. Errors use
 * GlobalExceptionFilter's shape.
 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [context.getHandler(), context.getClass()]);
    if (raw) return next.handle();
    return next.handle().pipe(
      map((data) => (data instanceof StreamableFile ? data : { success: true as const, data, timestamp: new Date().toISOString() })),
    );
  }
}
